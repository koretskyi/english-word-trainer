import { useEffect, useMemo, useRef, useState } from "react";
import WordGap, { createWordGapOpenedPositions } from "../components/LetterGap.jsx";

function parseVideoUrl(rawValue) {
  let url;
  try { url = new URL(String(rawValue || "").trim()); }
  catch { return { error: "Некорректная ссылка. Нужен адрес YouTube или TikTok." }; }
  if (!["https:", "http:"].includes(url.protocol)) return { error: "Используй ссылку http:// или https://." };
  const host = url.hostname.toLowerCase().replace(/^www\\./, "");
  if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
    let id = host === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0] : url.searchParams.get("v");
    if (!id) {
      const parts = url.pathname.split("/").filter(Boolean);
      const at = parts.findIndex((part) => ["embed", "shorts", "live", "v"].includes(part));
      if (at >= 0) id = parts[at + 1];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) return { error: "Не удалось определить YouTube-видео." };
    return { provider: "youtube", videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, originalUrl: url.href };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const id = url.pathname.match(/\\/video\\/(\\d+)/)?.[1] || url.pathname.match(/\\/player\\/v1\\/(\\d+)/)?.[1];
    if (!id) return { error: "Для TikTok нужна полная ссылка вида tiktok.com/@author/video/123456789." };
    return { provider: "tiktok", videoId: id, embedUrl: `https://www.tiktok.com/player/v1/${id}?controls=1&description=1&music_info=1&autoplay=0`, originalUrl: url.href };
  }
  return { error: "Поддерживаются только YouTube и TikTok." };
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[^\\p{L}\\p{N}'-]+/gu, " ").replace(/\\s+/g, " ").trim();
}

function tokenize(text) {
  return (String(text || "").match(/[A-Za-z]+|[^A-Za-z]+/g) || []).map((value, index) => ({
    id: `video-token-${index}`, value, isWord: /^[A-Za-z]+$/.test(value),
  }));
}

function PlatformIcon({ provider }) {
  if (provider === "youtube") return <svg viewBox="0 0 28 20" aria-hidden="true"><path fill="#ff0033" d="M27.4 3.1A3.5 3.5 0 0 0 25 0.7C22.9.1 14 .1 14 .1S5.1.1 3 .7A3.5 3.5 0 0 0 .6 3.1 36 36 0 0 0 0 10a36 36 0 0 0 .6 6.9A3.5 3.5 0 0 0 3 19.3c2.1.6 11 .6 11 .6s8.9 0 11-.6a3.5 3.5 0 0 0 2.4-2.4A36 36 0 0 0 28 10a36 36 0 0 0-.6-6.9Z"/><path fill="#fff" d="m11.2 14.2 7.3-4.2-7.3-4.2z"/></svg>;
  if (provider === "tiktok") return <svg viewBox="0 0 24 26" aria-hidden="true">
    <path fill="#25F4EE" d="M14 1h4c.2 2.8 1.7 4.7 4.5 5.3v4c-2-.1-3.7-.8-5-1.9v9.1a7 7 0 1 1-7-7c.5 0 1 .1 1.5.2v4.2a3 3 0 1 0 1.5 2.6V1Z" transform="translate(-1 1)"/>
    <path fill="#FE2C55" d="M14 1h4c.2 2.8 1.7 4.7 4.5 5.3v4c-2-.1-3.7-.8-5-1.9v9.1a7 7 0 1 1-7-7c.5 0 1 .1 1.5.2v4.2a3 3 0 1 0 1.5 2.6V1Z" transform="translate(1 -1)"/>
    <path fill="#111827" d="M14 1h4c.2 2.8 1.7 4.7 4.5 5.3v4c-2-.1-3.7-.8-5-1.9v9.1a7 7 0 1 1-7-7c.5 0 1 .1 1.5.2v4.2a3 3 0 1 0 1.5 2.6V1Z"/>
  </svg>;
  return <span>?</span>;
}

export default function VideoPage({ videos = [], onUpdateVideo }) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id || "");
  const selectedVideo = videos.find((item) => item.id === selectedId) || videos[0] || null;
  const parsed = useMemo(() => selectedVideo ? parseVideoUrl(selectedVideo.url) : null, [selectedVideo?.url]);
  const [captureStatus, setCaptureStatus] = useState("idle");
  const [captureError, setCaptureError] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const [wordAnswers, setWordAnswers] = useState({});
  const [checked, setChecked] = useState(false);
  const transcript = selectedVideo?.transcript || "";
  const tokens = useMemo(() => tokenize(transcript), [transcript]);
  const wordTokens = tokens.filter((token) => token.isWord);
  const opened = useMemo(() => Object.fromEntries(wordTokens.map((token) => [
    token.id, createWordGapOpenedPositions(token.value),
  ])), [selectedId, transcript]);
  const assembled = tokens.map((token) => token.isWord
    ? (wordAnswers[token.id] || []).join("") : token.value).join("");
  const allFilled = wordTokens.length > 0 && wordTokens.every((token) =>
    (wordAnswers[token.id] || []).length === [...token.value].length &&
    (wordAnswers[token.id] || []).every(Boolean)
  );
  const isCorrect = checked && normalizeText(assembled) === normalizeText(transcript);

  useEffect(() => {
    setWordAnswers({});
    setChecked(false);
  }, [selectedId, transcript]);

  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function saveTranscript(text) {
    if (!selectedVideo || !onUpdateVideo) return;
    onUpdateVideo({ ...selectedVideo, transcript: text });
    setWordAnswers({});
    setChecked(false);
  }

  async function startCapture() {
    setCaptureError("");
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setCaptureError("Этот браузер не поддерживает запись звука вкладки. Используй актуальный Chrome или Edge.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        setCaptureError("Звук не захвачен. В окне доступа выбери именно вкладку Chrome и включи «Поделиться аудио вкладки».");
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => setCaptureError("Не удалось записать звук вкладки.");
      recorder.onstop = async () => {
        setCaptureStatus("transcribing");
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setCaptureStatus("idle");
          setCaptureError("Запись пустая. Запусти ролик со звуком и повтори.");
          return;
        }
        if (blob.size > 20 * 1024 * 1024) {
          setCaptureStatus("idle");
          setCaptureError("Запись больше 20 МБ. Запиши более короткий фрагмент.");
          return;
        }
        setCaptureStatus("transcribing");
        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "audio/webm" },
            body: blob,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || "Ошибка распознавания речи.");
          const text = String(data.text || "").trim();
          if (!text) throw new Error("Whisper не распознал речь. Попробуй записать фрагмент громче или длиннее.");
          saveTranscript(text);
          setCaptureStatus("done");
        } catch (error) {
          setCaptureError(error.message || "Не удалось распознать речь.");
          setCaptureStatus("idle");
        }
      };
      recorder.start(500);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      }, { once: true });
      setCaptureStatus("recording");
    } catch (error) {
      if (error.name !== "NotAllowedError") setCaptureError(error.message || "Не удалось начать захват вкладки.");
      setCaptureStatus("idle");
    }
  }

  function stopCapture() {
    if (recorderRef.current?.state === "recording") {
      setCaptureStatus("transcribing");
      recorderRef.current.stop();
    }
  }

  function updateAnswer(token, value) {
    if (checked) return;
    setWordAnswers((current) => ({ ...current, [token.id]: value }));
  }

  function checkAnswers() {
    if (!allFilled) return;
    setChecked(true);
  }

  async function copyTranscript() {
    try { await navigator.clipboard.writeText(transcript); }
    catch { setCaptureError("Браузер не разрешил копирование. Выдели текст и скопируй вручную."); }
  }

  if (!videos.length) {
    return <section className="panel video-panel">
      <h2>Видео</h2>
      <div className="video-empty-state"><div className="video-empty-icon">▶</div>
        <strong>Библиотека пока пустая</strong>
        <p>Добавь YouTube- или TikTok-ссылки через «Админку».</p>
      </div>
    </section>;
  }

  return <section className="panel video-panel">
    <div className="video-page-heading"><div><p className="eyebrow">VIDEO LISTENING</p><h2>Видео</h2>
      <p className="video-intro">Выбери ролик, посмотри его и создай упражнение на понимание речи.</p></div>
      <span className="video-heading-icon" aria-hidden="true">▶</span>
    </div>

    <div className="video-library-list">
      {videos.map((video) => {
        const platform = parseVideoUrl(video.url);
        return <button type="button" key={video.id}
          className={`video-library-item ${selectedVideo?.id === video.id ? "selected" : ""}`}
          onClick={() => { setSelectedId(video.id); setCaptureError(""); setCaptureStatus("idle"); }}>
          <span className={`video-library-logo ${platform.provider || "unknown"}`}><PlatformIcon provider={platform.provider} /></span>
          <span className="video-library-title"><strong>{video.title}</strong><small>{video.level || "B1"} · {platform.provider === "youtube" ? "YouTube" : platform.provider === "tiktok" ? "TikTok" : "Проверь ссылку"}</small></span>
          <span className="video-library-arrow">›</span>
        </button>;
      })}
    </div>

    {selectedVideo && parsed?.error ? <p className="video-error" role="alert">{parsed.error}</p> : selectedVideo && <>
      <div className={`video-player-card ${parsed.provider === "tiktok" ? "video-player-tiktok" : "video-player-youtube"}`}>
        <div className="video-player-topline"><strong>{selectedVideo.title}</strong>
          <span>{selectedVideo.level || "B1"}</span></div>
        <div className="video-frame-wrap"><iframe key={parsed.embedUrl} src={parsed.embedUrl}
          title={selectedVideo.title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen /></div>
        <a className="video-original-link" href={parsed.originalUrl} target="_blank" rel="noreferrer">Открыть оригинал ↗</a>
      </div>

      <section className="video-transcription-panel">
        <h3>Распознать речь из ролика</h3>
        <p className="muted">Нажми запись, в окне браузера выбери вкладку с этим роликом и включи «Поделиться аудио вкладки». Запусти видео, затем останови запись.</p>
        <div className="video-capture-actions">
          {captureStatus === "recording"
            ? <button className="button button-danger" type="button" onClick={stopCapture}>■ Остановить запись</button>
            : <button className="button button-primary" type="button" disabled={captureStatus === "transcribing"} onClick={startCapture}>● Записать звук вкладки</button>}
          {captureStatus === "recording" && <span className="video-recording-indicator"><i /> Идёт запись звука</span>}
          {captureStatus === "transcribing" && <span className="muted">Whisper распознаёт речь…</span>}
          {captureStatus === "done" && <span className="video-success">Текст распознан</span>}
        </div>
        {captureError && <p className="video-error" role="alert">{captureError}</p>}
      </section>

      {transcript && <section className="video-exercise-panel">
        <div className="video-transcript-heading"><div><h3>Текст ролика</h3><p className="muted">Распознанный английский текст · можно скопировать</p></div>
          <button type="button" className="button button-secondary" onClick={copyTranscript}>Копировать текст</button></div>
        <p className="video-transcript-plain">{transcript}</p>
        <div className="video-mask-heading"><h3>Упражнение с маской</h3><span>{wordTokens.length} слов</span></div>
        <div className="video-mask-text">
          {tokens.map((token) => {
            if (!token.isWord) return <span key={token.id}>{token.value}</span>;
            return <WordGap key={token.id} sentence={{ id: `${selectedVideo.id}-${token.id}`, word: token.value }}
              value={wordAnswers[token.id] || Array([...token.value].length).fill("")}
              onChange={(value) => updateAnswer(token, value)} disabled={checked}
              autoFocus={false} showMistakes={checked && !isCorrect} openedPositions={opened[token.id]} />;
          })}
        </div>
        {checked && <div className={isCorrect ? "video-answer-feedback correct" : "video-answer-feedback incorrect"}>
          {isCorrect ? "✓ Отлично! Текст введён правильно." : "Есть ошибки. Красные буквы нужно исправить."}
        </div>}
        <div className="video-exercise-actions">
          {!checked ? <button className="button button-primary" type="button" disabled={!allFilled} onClick={checkAnswers}>Проверить текст</button>
            : <button className="button button-secondary" type="button" onClick={() => { setWordAnswers({}); setChecked(false); }}>Повторить</button>}
        </div>
      </section>}
    </>}
    <p className="video-legal-note">Приложение записывает только звук вкладки, который ты сам разрешил захватить. Распознавание выполняется локальным Whisper на твоём компьютере; само видео не скачивается.</p>
  </section>;
}
