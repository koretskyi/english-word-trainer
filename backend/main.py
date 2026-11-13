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


def clean_vtt(path: Path) -> str:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line == "WEBVTT" or line.startswith(("NOTE", "Kind:", "Language:")):
            continue
        if "-->" in line or re.fullmatch(r"\d+", line):
            continue
        line = re.sub(r"<[^>]*>", "", line)
        line = html.unescape(line).strip()
        if line and (not lines or line != lines[-1]):
            lines.append(line)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


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
            "--write-subs", "--write-auto-subs",
            "--sub-langs", "en,en.*",
            "--sub-format", "vtt/best",
            "--output", str(output / "%(id)s.%(ext)s"),
            url,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=90)
        except subprocess.TimeoutExpired as error:
            raise HTTPException(status_code=504, detail="YouTube слишком долго отвечает. Попробуй ещё раз.") from error

        subtitle_files = list(output.glob("*.vtt"))
        if result.returncode != 0 and not subtitle_files:
            details = (result.stderr or result.stdout or "").strip()
            message = "YouTube ограничил автоматический доступ к субтитрам." if "Sign in" in details or "bot" in details.lower() else "Не удалось получить субтитры. Возможно, они отключены или YouTube ограничил доступ."
            raise HTTPException(status_code=422, detail=message)
        if not subtitle_files:
            raise HTTPException(status_code=404, detail="У ролика нет доступных английских субтитров — ни авторских, ни автоматических.")

        subtitle_files.sort(key=lambda path: (0 if ".en." in path.name.lower() else 1, 0 if "orig" in path.name.lower() else 1, path.name))
        text = clean_vtt(subtitle_files[0])
        if not text:
            raise HTTPException(status_code=404, detail="YouTube вернул пустой файл субтитров.")
        return {"text": text}


@app.get("/health")
def health():
    return {"status": "ok"}
