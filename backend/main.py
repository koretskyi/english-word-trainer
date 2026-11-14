import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="English Word Trainer YouTube Subtitles API")


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
    # Parse cue-by-cue rather than relying on blank-line separators.
    # Some YouTube auto-caption VTT files place consecutive cues directly
    # on adjacent lines; splitting only on blank lines merges them into
    # one cue starting at 00:00 and defeats time-range filtering.
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
        cue_text = re.sub(r"\\s+", " ", cue_text).strip()
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
        cues = parse_vtt(subtitle_files[0])
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
    return {"status": "ok"}
