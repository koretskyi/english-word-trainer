import { useEffect, useMemo, useState } from "react";
import WordGap, { createWordGapOpenedPositions } from "../components/LetterGap.jsx";

function parseYouTubeUrl(rawValue) {
  let url;
  try { url = new URL(String(rawValue || "").trim()); }
  catch { return { error: "Некорректная ссылка YouTube." }; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    return { error: "Пока поддерживаются только ссылки YouTube." };
  }
  let id = host === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0] : url.searchParams.get("v");
  if (!id) {
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
    if (at >= 0) id = parts[at + 1];
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) return { error: "Не удалось определить YouTube-видео." };
  return { videoId: id, embedUrl: "https://www.youtube-nocookie.com/embed/" + id, originalUrl: url.href };
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  return (String(text || "").match(/[A-Za-z]+|[^A-Za-z]+/g) || []).map((value, index) => ({
    id: "video-token-" + index, value, isWord: /^[A-Za-z]+$/.test(value),
  }));
}

export default function VideoPage({ videos = [], onUpdateVideo }) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id || "");
  const selectedVideo = videos.find((item) => item.id === selectedId) || videos[0] || null;
  const parsed = useMemo(() => selectedVideo ? parseYouTubeUrl(selectedVideo.url) : null, [selectedVideo?.url]);
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

  function saveTranscript(text) {
    if (!selectedVideo || !onUpdateVideo) return;
    onUpdateVideo({ ...selectedVideo, transcript: text });
    setWordAnswers({});
    setChecked(false);
  }

  function updateAnswer(token, value) {
    if (checked) return;
    setWordAnswers((current) => ({ ...current, [token.id]: value }));
  }

  if (!videos.length) {
    return <section className="panel video-panel">
      <h2>Видео</h2>
      <div className="video-empty-state">
        <div className="video-empty-icon">▶</div>
        <strong>Библиотека пока пустая</strong>
        <p>Открой «Админку» и добавь ссылку на YouTube-ролик.</p>
      </div>
    </section>;
  }

  return <section className="panel video-panel">
    <div className="video-page-heading">
      <div><p className="eyebrow">YOUTUBE LISTENING</p><h2>Видео</h2>
        <p className="video-intro">Выбери ролик и загрузи доступные английские субтитры YouTube.</p>
      </div>
      <span className="video-heading-icon" aria-hidden="true">▶</span>
    </div>
    <div className="video-library-list">
      {videos.map((item) => (
        <button type="button" key={item.id}
          className={"video-library-item " + (selectedVideo?.id === item.id ? "selected" : "")}
          onClick={() => setSelectedId(item.id)}>
          <span className="video-library-logo youtube">▶</span>
          <span className="video-library-title"><strong>{item.title}</strong>
            <small>{item.level || "B1"} · YouTube</small></span>
          <span className="video-library-arrow">›</span>
        </button>
      ))}
    </div>
    {selectedVideo && parsed?.error ? <p className="video-error" role="alert">{parsed.error}</p> : selectedVideo && <>
      <div className="video-player-card video-player-youtube">
        <div className="video-player-topline"><strong>{selectedVideo.title}</strong><span>{selectedVideo.level || "B1"}</span></div>
        <div className="video-frame-wrap">
          <iframe key={parsed.embedUrl} src={parsed.embedUrl} title={selectedVideo.title}
            loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen />
        </div>
        <a className="video-original-link" href={parsed.originalUrl} target="_blank" rel="noreferrer">Открыть оригинал ↗</a>
      </div>
      <section className="video-transcription-panel">
        <h3>Субтитры YouTube</h3>
        <p className="muted">{transcript ? "Субтитры подготовлены администратором." : "Субтитры для этого ролика ещё не загружены. Попроси администратора подготовить их в админке."}</p>
      </section>
      {transcript && <section className="video-exercise-panel">
        <div className="video-transcript-heading">
          <div><h3>Текст субтитров</h3><p className="muted">Английский текст, полученный с YouTube</p></div>
          <button type="button" className="button button-secondary"
            onClick={() => navigator.clipboard?.writeText(transcript)}>Копировать текст</button>
        </div>
        <p className="video-transcript-plain">{transcript}</p>
        <div className="video-mask-heading"><h3>Упражнение с маской</h3><span>{wordTokens.length} слов</span></div>
        <div className="video-mask-text">
          {tokens.map((token) => {
            if (!token.isWord) return <span key={token.id}>{token.value}</span>;
            return <WordGap key={token.id}
              sentence={{ id: selectedVideo.id + "-" + token.id, word: token.value }}
              value={wordAnswers[token.id] || Array([...token.value].length).fill("")}
              onChange={(value) => updateAnswer(token, value)} disabled={checked}
              autoFocus={false} showMistakes={checked && !isCorrect}
              openedPositions={opened[token.id]} />;
          })}
        </div>
        {checked && <div className={isCorrect ? "video-answer-feedback correct" : "video-answer-feedback incorrect"}>
          {isCorrect ? "✓ Отлично! Текст введён правильно." : "Есть ошибки. Красные буквы нужно исправить."}
        </div>}
        <div className="video-exercise-actions">
          {!checked
            ? <button className="button button-primary" type="button" disabled={!allFilled} onClick={() => setChecked(true)}>Проверить текст</button>
            : <button className="button button-secondary" type="button" onClick={() => { setWordAnswers({}); setChecked(false); }}>Повторить</button>}
        </div>
      </section>}
    </>}
    <p className="video-legal-note">Используются только субтитры, которые YouTube отдаёт для выбранного ролика. Само видео не скачивается.</p>
  </section>;
}
