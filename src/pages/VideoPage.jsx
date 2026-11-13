import { useState } from "react";

const STORAGE_KEY = "english-word-trainer-video-url-v1";

function parseVideoUrl(rawValue) {
  let url;

  try {
    url = new URL(rawValue.trim());
  } catch {
    return { error: "Вставь корректную ссылку на YouTube или TikTok." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "Поддерживаются только ссылки, начинающиеся с http:// или https://." };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com";

  if (isYouTube) {
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else {
      videoId = url.searchParams.get("v") || "";
      if (!videoId) {
        const parts = url.pathname.split("/").filter(Boolean);
        const markerIndex = parts.findIndex((part) =>
          ["embed", "shorts", "live", "v"].includes(part)
        );
        if (markerIndex >= 0) videoId = parts[markerIndex + 1] || "";
      }
    }

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return { error: "Не удалось определить YouTube-видео. Скопируй обычную ссылку на ролик." };
    }

    return {
      provider: "youtube",
      videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      originalUrl: url.href,
    };
  }

  const isTikTok = host === "tiktok.com" || host.endsWith(".tiktok.com");
  if (isTikTok) {
    const playerMatch = url.pathname.match(/\/player\/v1\/(\d+)/);
    const videoMatch = url.pathname.match(/\/video\/(\d+)/);
    const videoId = playerMatch?.[1] || videoMatch?.[1];

    if (!videoId) {
      return {
        error: "Это короткая ссылка TikTok. Открой ролик в браузере и скопируй полный адрес вида tiktok.com/@автор/video/123456789.",
      };
    }

    return {
      provider: "tiktok",
      videoId,
      embedUrl: `https://www.tiktok.com/player/v1/${videoId}?controls=1&description=1&music_info=1&autoplay=0`,
      originalUrl: url.href,
    };
  }

  return { error: "Ссылка должна вести на YouTube или TikTok." };
}

export default function VideoPage() {
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [activeVideo, setActiveVideo] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? parseVideoUrl(saved) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? parseVideoUrl(saved) : null;
      return parsed && !parsed.error ? parsed.provider : "youtube";
    } catch {
      return "youtube";
    }
  });

  function addVideo(event) {
    event.preventDefault();
    const parsed = parseVideoUrl(url);

    if (parsed.error) {
      setError(parsed.error);
      setActiveVideo(null);
      return;
    }

    if (parsed.provider !== selectedProvider) {
      setError(`Ссылка ведёт на ${parsed.provider === "youtube" ? "YouTube" : "TikTok"}. Выбери соответствующую кнопку выше.`);
      setActiveVideo(null);
      return;
    }

    setError("");
    setActiveVideo(parsed);
    try {
      localStorage.setItem(STORAGE_KEY, url.trim());
    } catch (storageError) {
      console.warn("Не удалось сохранить ссылку на видео:", storageError);
    }
  }

  function clearVideo() {
    setUrl("");
    setActiveVideo(null);
    setError("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (storageError) {
      console.warn("Не удалось удалить сохранённую ссылку:", storageError);
    }
  }

  return (
    <section className="panel video-panel">
      <div className="video-page-heading">
        <div>
          <p className="eyebrow">VIDEO LISTENING</p>
          <h2>Видео</h2>
          <p className="video-intro">
            Вставь ссылку на ролик — он откроется здесь через официальный плеер платформы.
          </p>
        </div>
        <span className="video-heading-icon" aria-hidden="true">▶</span>
      </div>

      <div className="video-platform-picker" role="group" aria-label="Выбрать видеоплатформу">
        <button
          type="button"
          className={`video-platform-button youtube-choice ${selectedProvider === "youtube" ? "selected" : ""}`}
          aria-pressed={selectedProvider === "youtube"}
          onClick={() => {
            setSelectedProvider("youtube");
            setError("");
            setUrl("");
          }}
        >
          <svg className="platform-button-icon youtube-mark" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 9.2 15 12l-5 2.8z" fill="currentColor" />
          </svg>
          <strong>YouTube</strong>
        </button>
        <button
          type="button"
          className={`video-platform-button tiktok-choice ${selectedProvider === "tiktok" ? "selected" : ""}`}
          aria-pressed={selectedProvider === "tiktok"}
          onClick={() => {
            setSelectedProvider("tiktok");
            setError("");
            setUrl("");
          }}
        >
          <svg className="platform-button-icon tiktok-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.2 3v11.1a4.1 4.1 0 1 1-3.1-4V13a1.5 1.5 0 1 0 1.1 1.4V3h2.1c.3 2 1.5 3.4 3.7 3.8v2.2A6.4 6.4 0 0 1 14.2 7z" fill="currentColor" />
          </svg>
          <strong>TikTok</strong>
        </button>
      </div>

      <form className="video-link-form" onSubmit={addVideo}>
        <label htmlFor="video-url">Ссылка на {selectedProvider === "youtube" ? "YouTube" : "TikTok"}-видео</label>
        <div className="video-link-row">
          <input
            id="video-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={selectedProvider === "youtube"
              ? "Вставь ссылку на YouTube-видео или Shorts"
              : "Вставь полную ссылку на TikTok-ролик"}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (error) setError("");
            }}
          />
          <button className="button button-primary" type="submit" disabled={!url.trim()}>
            Открыть
          </button>
        </div>
        {error && <p className="video-error" role="alert">{error}</p>}
      </form>

      {activeVideo && !activeVideo.error ? (
        <div className={`video-player-card ${activeVideo.provider === "tiktok" ? "video-player-tiktok" : "video-player-youtube"}`}>
          <div className="video-player-topline">
            <strong>{activeVideo.provider === "youtube" ? "YouTube" : "TikTok"}</strong>
            <button className="video-clear-button" type="button" onClick={clearVideo}>
              Удалить видео
            </button>
          </div>
          <div className="video-frame-wrap">
            <iframe
              key={activeVideo.embedUrl}
              src={activeVideo.embedUrl}
              title={activeVideo.provider === "youtube" ? "YouTube video player" : "TikTok video player"}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow={activeVideo.provider === "youtube"
                ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                : "encrypted-media; fullscreen"}
              allowFullScreen
            />
          </div>
          <a className="video-original-link" href={activeVideo.originalUrl} target="_blank" rel="noreferrer">
            Открыть оригинал на {activeVideo.provider === "youtube" ? "YouTube" : "TikTok"} ↗
          </a>
        </div>
      ) : (
        <div className="video-empty-state">
          <div className="video-empty-icon" aria-hidden="true">▶</div>
          <strong>Добавь первое видео</strong>
          <p>Вставь ссылку выше. Плеер появится здесь.</p>
        </div>
      )}

      <p className="video-legal-note">
        Видео воспроизводится с платформы-источника. Приложение не скачивает и не хранит копии роликов.
      </p>
    </section>
  );
}
