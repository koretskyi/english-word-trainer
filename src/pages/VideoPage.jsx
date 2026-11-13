import { useEffect, useState } from "react";

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

  useEffect(() => {
    return () => {
      // The embedded player is removed naturally when this page unmounts.
    };
  }, []);

  function addVideo(event) {
    event.preventDefault();
    const parsed = parseVideoUrl(url);

    if (parsed.error) {
      setError(parsed.error);
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

      <form className="video-link-form" onSubmit={addVideo}>
        <label htmlFor="video-url">Ссылка на YouTube или TikTok</label>
        <div className="video-link-row">
          <input
            id="video-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://www.youtube.com/watch?v=... или https://www.tiktok.com/@..."
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
        <div className="video-supported-platforms">
          <span className="video-platform youtube-platform">YouTube</span>
          <span className="video-platform tiktok-platform">TikTok</span>
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
                : "fullscreen"}
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
