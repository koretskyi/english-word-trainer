import html
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

# Load the model once and reuse it for every microphone recording.
_whisper_model = None


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            _whisper_model = WhisperModel(
                "small",
                device="cpu",
                compute_type="int8",
            )
        except Exception as error:
            raise HTTPException(
                status_code=503,
                detail=f"Не удалось загрузить локальную модель Whisper: {error}",
            ) from error
    return _whisper_model


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
        raise HTTPException(status_code=400, detail="Получена пустая аудиозапись.")

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
        raise HTTPException(status_code=422, detail="Запись слишком короткая. Произнеси слово ещё раз.")

    model = get_whisper_model()
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
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Ошибка локального распознавания Whisper: {error}") from error

    return {"text": transcript, "engine": "faster-whisper small (CPU INT8)"}


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
        "engine": "faster-whisper small / CPU INT8",
    }
