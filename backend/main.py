import gc
import html
import logging
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from faster_whisper import WhisperModel
from pydantic import BaseModel

app = FastAPI(title="English Word Trainer Local Whisper API")
logger = logging.getLogger("uvicorn.error")

# Keep only the currently selected model in memory to avoid loading Medium and Small together.
_whisper_model = None
_whisper_model_size = None


def get_whisper_model(model_size: str = "medium"):
    global _whisper_model, _whisper_model_size
    if model_size not in {"medium", "small"}:
        model_size = "medium"
    if _whisper_model is None or _whisper_model_size != model_size:
        if _whisper_model is not None:
            _whisper_model = None
            _whisper_model_size = None
            gc.collect()
        try:
            logger.info("Loading Faster-Whisper model: %s (CPU INT8)", model_size)
            _whisper_model = WhisperModel(
                model_size,
                device="cpu",
                compute_type="int8",
            )
            _whisper_model_size = model_size
            logger.info("Faster-Whisper model loaded: %s", model_size)
        except Exception as error:
            raise HTTPException(
                status_code=503,
                detail=f"Не удалось загрузить локальную модель Whisper {model_size}: {error}",
            ) from error
    return _whisper_model


def normalize_spoken_word(value: str) -> str:
    """Keep only English letters and compare without case or punctuation."""
    return re.sub(r"[^a-z]", "", value.casefold())


def levenshtein_distance(left: str, right: str) -> int:
    """Return the minimum number of single-character insertions, deletions and substitutions."""
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            current.append(min(
                current[-1] + 1,
                previous[j] + 1,
                previous[j - 1] + (left_char != right_char),
            ))
        previous = current
    return previous[-1]


class SubtitleRequest(BaseModel):
    url: str
    startTime: str = "00:00"
    endTime: str = ""


def parse_timestamp(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    try:
        seconds = float(parts[-1])
        minutes = int(parts[-2]) if len(parts) >= 2 else 0
        hours = int(parts[-3]) if len(parts) >= 3 else 0
        return hours * 3600 + minutes * 60 + seconds
    except (ValueError, IndexError):
        return 0.0


def parse_vtt(path: Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues = []
    current_start = None
    current_end = None
    text_lines = []

    def flush_cue():
        if current_start is None or current_end is None:
            return
        cleaned = [re.sub(r"<[^>]*>", "", line).strip() for line in text_lines]
        cue_text = html.unescape(" ".join(line for line in cleaned if line))
        cue_text = re.sub(r"\s+", " ", cue_text).strip()
        if cue_text:
            cues.append({"start": current_start, "end": current_end, "text": cue_text})

    for line in lines:
        line = line.strip()
        if "-->" in line:
            flush_cue()
            timing = line.split("-->")
            if len(timing) != 2:
                current_start = current_end = None
                text_lines = []
                continue
            start_token = timing[0].strip().split()[0]
            end_token = timing[1].strip().split()[0]
            current_start = parse_timestamp(start_token)
            current_end = parse_timestamp(end_token)
            text_lines = []
        elif current_start is not None and line and not line.startswith(("NOTE", "STYLE", "REGION")):
            text_lines.append(line)

    flush_cue()
    return cues


def normalize_subtitle_cues(cues: list[dict]) -> list[dict]:
    """Collapse YouTube's rolling captions into sentence-level cues."""
    valid = [
        cue for cue in cues
        if float(cue.get("end", 0)) - float(cue.get("start", 0)) > 0.1
        and str(cue.get("text", "")).strip()
    ]
    valid.sort(key=lambda cue: (float(cue["start"]), float(cue["end"])))

    def tokens(value: str) -> list[str]:
        return re.findall(r"[\w]+(?:['’\-][\w]+)*|[.!?]+|[,;:]", value, flags=re.UNICODE)

    def token_key(value: str) -> str:
        return value.casefold().replace("’", "'")

    def join_tokens(values: list[str]) -> str:
        text = " ".join(values)
        return re.sub(r"\s+([.!?,;:])", r"\1", text).strip()

    normalized = []
    previous_tokens = []
    pending_text = ""
    pending_start = None
    pending_end = None

    for cue in valid:
        current_tokens = tokens(str(cue["text"]).strip())
        overlap = 0
        max_overlap = min(len(previous_tokens), len(current_tokens))
        for size in range(max_overlap, 0, -1):
            if [token_key(item) for item in previous_tokens[-size:]] == [
                token_key(item) for item in current_tokens[:size]
            ]:
                overlap = size
                break

        delta = current_tokens[overlap:]
        previous_tokens = current_tokens
        if not delta:
            continue

        delta_text = join_tokens(delta)
        if not delta_text:
            continue
        if not pending_text:
            pending_start = float(cue["start"])
        pending_text = (pending_text + " " + delta_text).strip()
        pending_end = float(cue["end"])

        completed = list(re.finditer(r".*?(?<!\bMr)(?<!\bMrs)(?<!\bMs)(?<!\bDr)(?<!\bSt)(?<!\bJr)(?<!\bSr)(?<!\bvs)(?<!\betc)[.!?]+(?=\s|$)", pending_text, flags=re.IGNORECASE))
        consumed = 0
        for match in completed:
            sentence_text = match.group(0).strip()
            if sentence_text:
                normalized.append({
                    "start": pending_start,
                    "end": pending_end,
                    "text": sentence_text,
                })
            consumed = match.end()

        if consumed:
            pending_text = pending_text[consumed:].strip()
            pending_start = float(cue["start"]) if pending_text else None

    if pending_text:
        normalized.append({
            "start": pending_start if pending_start is not None else float(valid[-1]["start"]),
            "end": pending_end if pending_end is not None else float(valid[-1]["end"]),
            "text": pending_text,
        })

    return [
        cue for cue in normalized
        if cue["end"] > cue["start"] and cue["text"].strip()
    ]


@app.post("/api/transcribe")
async def transcribe_audio(request: Request):
    audio = await request.body()
    if not audio:
        logger.warning("Whisper request received with empty audio body")
        raise HTTPException(status_code=400, detail="Получена пустая аудиозапись.")
    logger.info("Whisper audio received: %d bytes; content-type=%s", len(audio), request.headers.get("content-type", "unknown"))

    try:
        # MediaRecorder sends WebM/Opus (or the browser's supported audio format).
        # FFmpeg decodes it to mono 16 kHz float audio for faster-whisper.
        decoded = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error",
                "-i", "pipe:0",
                "-f", "f32le", "-ac", "1", "-ar", "16000",
                "pipe:1",
            ],
            input=audio,
            capture_output=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail="FFmpeg не найден. Установи FFmpeg и добавь его в PATH.") from error
    except subprocess.TimeoutExpired as error:
        raise HTTPException(status_code=504, detail="Не удалось декодировать аудиозапись вовремя.") from error

    if decoded.returncode != 0 or not decoded.stdout:
        raise HTTPException(status_code=422, detail="Не удалось прочитать аудиозапись. Попробуй записать ответ ещё раз.")

    audio_samples = np.frombuffer(decoded.stdout, dtype=np.float32)
    if audio_samples.size < 1600:
        logger.warning("Whisper audio too short: %d samples", audio_samples.size)
        raise HTTPException(status_code=422, detail="Запись слишком короткая. Произнеси слово ещё раз.")

    requested_model = request.headers.get("x-whisper-model", "medium").strip().lower()
    model_size = requested_model if requested_model in {"medium", "small"} else "medium"
    logger.info("Whisper decoded audio: %.2f seconds; model=%s; expected-word=%r", audio_samples.size / 16000, model_size, request.headers.get("x-expected-word", "").strip())
    model = get_whisper_model(model_size)
    try:
        expected_word = request.headers.get("x-expected-word", "").strip()
        # Use Faster-Whisper's dedicated hotwords hint instead of a sentence
        # prompt. This biases decoding toward the target word without asking
        # the model to generate that word regardless of the audio.
        hotwords = expected_word if expected_word and len(expected_word) <= 80 else None
        segments, _ = model.transcribe(
            audio_samples,
            language="en",
            hotwords=hotwords,
            beam_size=1,
            max_new_tokens=8,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        raw_transcript = " ".join(segment.text.strip() for segment in segments).strip()
        # Keep the response focused: at most two recognized English words.
        recognized_words = re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", raw_transcript)
        transcript = " ".join(recognized_words[:2])
        logger.info("Whisper result (limited to 2 words): raw=%r final=%r", raw_transcript, transcript)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Ошибка локального распознавания Whisper: {error}") from error

    expected_word = request.headers.get("x-expected-word", "").strip()
    expected_normalized = normalize_spoken_word(expected_word)
    recognized_tokens = [
        normalize_spoken_word(token)
        for token in re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", transcript)
    ]
    recognized_tokens = [token for token in recognized_tokens if token]

    # Match the target against individual recognized words, allowing up to
    # three character edits (insertions, deletions or substitutions).
    distances = [
        levenshtein_distance(expected_normalized, token)
        for token in recognized_tokens
    ] if expected_normalized else []
    best_distance = min(distances) if distances else None
    is_correct = best_distance is not None and best_distance <= 3

    logger.info(
        "Word check: expected=%r recognized=%r distance=%r correct=%s",
        expected_word, transcript, best_distance, is_correct,
    )
    return {
        "text": transcript,
        "expected": expected_word,
        "is_correct": is_correct,
        "edit_distance": best_distance,
        "engine": f"faster-whisper {model_size} (CPU INT8)",
    }


@app.post("/api/youtube-subtitles")
async def youtube_subtitles(payload: SubtitleRequest):
    url = payload.url.strip()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or host not in {
        "youtube.com", "www.youtube.com", "m.youtube.com",
        "music.youtube.com", "youtu.be"
    }:
        raise HTTPException(status_code=400, detail="Поддерживаются только ссылки YouTube.")

    with tempfile.TemporaryDirectory(prefix="ewt-youtube-subs-") as temp_dir:
        output = Path(temp_dir)
        command = [
            sys.executable, "-m", "yt_dlp",
            "--no-warnings", "--no-playlist", "--skip-download",
            "--js-runtimes", "node",
            "--remote-components", "ejs:github",
            "--write-subs", "--write-auto-subs",
            "--sub-langs", "en-US,en",
            "--sub-format", "vtt/best",
            "--output", str(output / "%(id)s.%(ext)s"),
            url,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired as error:
            raise HTTPException(status_code=504, detail="YouTube слишком долго отвечает. Попробуй ещё раз.") from error

        subtitle_files = list(output.glob("*.vtt"))
        if result.returncode != 0 and not subtitle_files:
            details = (result.stderr or result.stdout or "").strip()
            message = "YouTube ограничил автоматический доступ к субтитрам." if "Sign in" in details or "bot" in details.lower() else "Не удалось получить субтитры. Возможно, они отключены или YouTube ограничил доступ."
            raise HTTPException(status_code=422, detail=message)
        if not subtitle_files:
            raise HTTPException(status_code=404, detail="У ролика нет доступных английских субтитров — ни авторских, ни автоматических.")

        subtitle_files.sort(key=lambda path: (0 if re.search(r"\.en(?:-[a-z]{2})?\.", path.name.lower()) else 1, 0 if "orig" in path.name.lower() else 1, path.name))
        cues = normalize_subtitle_cues(parse_vtt(subtitle_files[0]))
        if not cues:
            raise HTTPException(status_code=404, detail="YouTube вернул пустой файл субтитров.")
        start_seconds = parse_timestamp(payload.startTime)
        end_seconds = parse_timestamp(payload.endTime) if payload.endTime.strip() else None
        if end_seconds is not None and end_seconds <= start_seconds:
            raise HTTPException(status_code=400, detail="Время окончания должно быть позже времени начала.")
        if start_seconds > 0 or end_seconds is not None:
            cues = [cue for cue in cues if cue["start"] < (end_seconds if end_seconds is not None else float("inf")) and cue["end"] > start_seconds]
        if not cues:
            raise HTTPException(status_code=404, detail="В выбранном временном отрезке нет английских субтитров.")
        return {"text": " ".join(cue["text"] for cue in cues), "cues": cues}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "whisper": "loaded" if _whisper_model is not None else "not_loaded",
        "model": _whisper_model_size or "medium (default)",
        "engine": f"faster-whisper {_whisper_model_size or 'medium (default)'} / CPU INT8",
    }
