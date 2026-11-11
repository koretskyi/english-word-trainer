import os
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from scipy.io.wavfile import read as read_wav
from faster_whisper import WhisperModel

MODEL = None
MAX_AUDIO_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL
    MODEL = await run_in_threadpool(
        WhisperModel, "small", device="cpu", compute_type="int8"
    )
    yield
    MODEL = None


app = FastAPI(title="English Word Trainer Local Speech API", lifespan=lifespan)


def transcribe_bytes(audio_bytes: bytes) -> str:
    if not MODEL:
        raise RuntimeError("Модель распознавания ещё загружается.")

    with tempfile.TemporaryDirectory(prefix="english-word-trainer-") as temp_dir:
        input_path = Path(temp_dir) / "recording.webm"
        wav_path = Path(temp_dir) / "recording.wav"
        input_path.write_bytes(audio_bytes)

        ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
        command = [
            ffmpeg, "-y", "-i", str(input_path),
            "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", str(wav_path),
        ]
        try:
            converted = subprocess.run(
                command, capture_output=True, text=True, timeout=60
            )
        except FileNotFoundError:
            raise RuntimeError("FFmpeg не найден. Установи FFmpeg и перезапусти приложение.")
        except subprocess.TimeoutExpired:
            raise RuntimeError("Преобразование аудио заняло слишком много времени.")

        if converted.returncode != 0 or not wav_path.exists():
            details = (converted.stderr or "").strip()
            raise RuntimeError("Не удалось декодировать аудио." + (f" {details[-500:]}" if details else ""))

        sample_rate, audio = read_wav(str(wav_path))
        if sample_rate != 16000:
            raise RuntimeError(f"Неверная частота аудио: {sample_rate} Гц.")

        original_dtype = audio.dtype
        audio = audio.astype(np.float32)
        if original_dtype == np.int16:
            audio /= 32768.0
        elif original_dtype == np.int32:
            audio /= 2147483648.0

        segments, _ = MODEL.transcribe(
            audio,
            language="en",
            beam_size=5,
            vad_filter=True,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


@app.post("/api/transcribe")
async def transcribe(request: Request):
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="Ожидается аудиофайл.")

    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Аудиозапись пустая.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Аудиофайл слишком большой (максимум 20 МБ).")

    try:
        text = await run_in_threadpool(transcribe_bytes, audio_bytes)
        return {"text": text}
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Ошибка локального распознавания речи.") from error


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": MODEL is not None}
