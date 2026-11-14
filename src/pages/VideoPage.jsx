import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WordGap, { createWordGapOpenedPositions } from "../components/LetterGap.jsx";
import { startAutoVoiceCapture } from "../utils/autoVoice.js";

let youtubeIframeApiPromise = null;

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve(window.YT);
    };
    let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        youtubeIframeApiPromise = null;
        reject(new Error("Не удалось загрузить плеер YouTube."));
      };
      document.head.appendChild(script);
    }
  });
  return youtubeIframeApiPromise;
}

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
  return { videoId: id, originalUrl: url.href };
}

function formatRemainingTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(remainingSeconds).padStart(2, "0")
    : minutes + ":" + String(remainingSeconds).padStart(2, "0");
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

function parseVideoTime(value) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function normalizeSubtitleCues(cues) {
  const valid = [...cues]
    .filter((cue) => {
      const start = Number(cue.start);
      const end = Number(cue.end);
      return String(cue.text || "").trim() &&
        Number.isFinite(start) && Number.isFinite(end) && end - start > 0.1;
    })
    .sort((a, b) => Number(a.start) - Number(b.start) || Number(a.end) - Number(b.end));

  const getTokens = (value) => value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|[.!?]+|[,;:]/gu) || [];
  const tokenKey = (value) => value.toLocaleLowerCase().replace(/’/g, "'");
  const joinTokens = (values) => values.join(" ").replace(/\s+([.!?,;:])/g, "$1").trim();

  const result = [];
  let previousTokens = [];
  let pendingText = "";
  let pendingStart = null;
  let pendingEnd = null;

  for (const cue of valid) {
    const currentTokens = getTokens(String(cue.text).trim());
    let overlap = 0;
    const maxOverlap = Math.min(previousTokens.length, currentTokens.length);
    for (let size = maxOverlap; size > 0; size -= 1) {
      const previousSuffix = previousTokens.slice(-size).map(tokenKey);
      const currentPrefix = currentTokens.slice(0, size).map(tokenKey);
      if (previousSuffix.every((token, index) => token === currentPrefix[index])) {
        overlap = size;
        break;
      }
    }

    const delta = currentTokens.slice(overlap);
    previousTokens = currentTokens;
    if (!delta.length) continue;

    const deltaText = joinTokens(delta);
    if (!deltaText) continue;
    if (!pendingText) pendingStart = Number(cue.start);
    pendingText = (pendingText + " " + deltaText).trim();
    pendingEnd = Number(cue.end);

    const completed = [...pendingText.matchAll(/.*?(?<!\bMr)(?<!\bMrs)(?<!\bMs)(?<!\bDr)(?<!\bSt)(?<!\bJr)(?<!\bSr)(?<!\bvs)(?<!\betc)[.!?]+(?=\s|$)/gi)];
    let consumed = 0;
    for (const match of completed) {
      const sentenceText = match[0].trim();
      if (sentenceText) {
        result.push({ start: pendingStart, end: pendingEnd, text: sentenceText });
      }
      consumed = match.index + match[0].length;
    }

    if (consumed) {
      pendingText = pendingText.slice(consumed).trim();
      pendingStart = pendingText ? Number(cue.start) : null;
    }
  }

  if (pendingText) {
    result.push({
      start: pendingStart ?? Number(valid[valid.length - 1].start),
      end: pendingEnd ?? Number(valid[valid.length - 1].end),
      text: pendingText,
    });
  }

  return result.filter((cue) => cue.end > cue.start && cue.text.trim());
}

function buildTrainingBlocks(cues, startSeconds, endSeconds) {
  // Each subtitle cue is one exercise. Keep YouTube's original cue boundaries and timestamps.
  return [...cues]
    .filter((cue) => {
      const cueStart = Number(cue.start);
      const cueEnd = Number(cue.end);
      return String(cue.text || "").trim() &&
        Number.isFinite(cueStart) && Number.isFinite(cueEnd) &&
        cueEnd > startSeconds && cueStart < (endSeconds ?? Infinity);
    })
    .sort((a, b) => Number(a.start) - Number(b.start))
    .map((cue, index) => {
      const start = Math.max(Number(cue.start), startSeconds);
      const end = Math.min(Number(cue.end), endSeconds ?? Infinity);
      const text = String(cue.text || "").trim();
      const sentence = { text, start, end };
      const wordCount = (text.match(/[\\p{L}\\p{N}]+(?:['’\\-][\\p{L}\\p{N}]+)*/gu) || [])
        .filter((word) => (word.match(/[\\p{L}\\p{N}]/gu) || []).length >= 3).length;
      return {
        id: "cue-" + index,
        text,
        sentences: [sentence],
        start,
        end,
        wordCount,
      };
    })
    .filter((block) => block.end > block.start);
}

export default function VideoPage({ videos = [], completedVideoIds = [], onCompleteVideo = () => {} }) {
  const [selectedId, setSelectedId] = useState("");
  const [showCompletion, setShowCompletion] = useState(false);
  const selectedVideo = videos.find((item) => item.id === selectedId) || null;
  const parsed = useMemo(() => selectedVideo ? parseYouTubeUrl(selectedVideo.url) : null, [selectedVideo?.url]);
  const startSeconds = parseVideoTime(selectedVideo?.startTime);
  const endSeconds = selectedVideo?.endTime ? parseVideoTime(selectedVideo.endTime) : null;
  const subtitleCues = Array.isArray(selectedVideo?.subtitleCues) ? selectedVideo.subtitleCues : [];
  const trainingBlocks = useMemo(
    () => buildTrainingBlocks(subtitleCues, startSeconds, endSeconds),
    [selectedId, subtitleCues, startSeconds, endSeconds]
  );

  const playerContainerRef = useRef(null);
  const playerCardRef = useRef(null);
  const exercisePanelRef = useRef(null);
  const playerRef = useRef(null);
  const captureRef = useRef(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [trainingStarted, setTrainingStarted] = useState(false);
  const [blockIndex, setBlockIndex] = useState(0);
  const [activeBlockIndex, setActiveBlockIndex] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceAnswer, setVoiceAnswer] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [answerResult, setAnswerResult] = useState("");
  const [videoWordAnswers, setVideoWordAnswers] = useState({});
  const [replayingBlock, setReplayingBlock] = useState(false);
  const [replayingSentenceIndex, setReplayingSentenceIndex] = useState(null);
  const [revealedSentences, setRevealedSentences] = useState({});
  const [sentenceVoiceAnswers, setSentenceVoiceAnswers] = useState({});
  const [recordingSentenceIndex, setRecordingSentenceIndex] = useState(null);
  const wordInputRefs = useRef([]);
  const wordLastInputRefs = useRef([]);
  const revealTimerRefs = useRef({});
  const [hintsRemaining, setHintsRemaining] = useState(0);
  const activeBlock = activeBlockIndex === null ? null : trainingBlocks[activeBlockIndex];

  const exerciseSentences = useMemo(() => {
    if (!activeBlock) return [];
    const sentences = activeBlock.sentences?.length
      ? activeBlock.sentences
      : [{ text: activeBlock.text }];
    return sentences.map((sentence, sentenceIndex) => ({
      ...sentence,
      tokens: tokenize(sentence.text).map((token) => ({
        ...token,
        id: "sentence-" + sentenceIndex + "-" + token.id,
      })),
    }));
  }, [selectedId, activeBlock?.id]);
  const exerciseWordTokens = exerciseSentences.flatMap((sentence) => sentence.tokens.filter((token) => token.isWord));
  exerciseWordTokens.forEach((_, index) => {
    if (!wordInputRefs.current[index]) wordInputRefs.current[index] = { current: null };
    if (!wordLastInputRefs.current[index]) wordLastInputRefs.current[index] = { current: null };
  });
  const openedPositions = useMemo(
    () => Object.fromEntries(exerciseWordTokens.map((token) => [
      token.id, createWordGapOpenedPositions(token.value),
    ])),
    [selectedId, activeBlock?.id]
  );

  useEffect(() => {
    let cancelled = false;
    setPlayerReady(false);
    setPlayerError("");
    setTrainingStarted(false);
    setBlockIndex(0);
    setActiveBlockIndex(null);
    setVoiceStatus("idle");
    setVoiceAnswer("");
    setVoiceError("");
    setAnswerResult("");
    setVideoWordAnswers({});
    setReplayingBlock(false);

    if (!parsed?.videoId || !playerContainerRef.current) return undefined;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !playerContainerRef.current) return;
        // Keep React's container separate from the DOM node that YouTube replaces
        // with its iframe. This prevents React/YouTube from removing the same node.
        const playerMountNode = document.createElement("div");
        playerMountNode.className = "video-youtube-player-mount";
        playerContainerRef.current.replaceChildren(playerMountNode);
        const player = new YT.Player(playerMountNode, {
          host: "https://www.youtube-nocookie.com",
          videoId: parsed.videoId,
          playerVars: {
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            rel: 0,
            start: Math.floor(startSeconds),
            ...(endSeconds !== null && endSeconds > startSeconds ? { end: Math.floor(endSeconds) } : {}),
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (!cancelled) setPlayerReady(true);
            },
            onStateChange: (event) => {
              if (event.data === 0) setTrainingStarted(false);
            },
            onError: () => setPlayerError("YouTube не удалось загрузить это видео. Открой оригинал по ссылке ниже."),
          },
        });
        playerRef.current = player;
      })
      .catch((error) => {
        if (!cancelled) setPlayerError(error.message || "Не удалось загрузить плеер YouTube.");
      });

    return () => {
      cancelled = true;
      captureRef.current?.stop();
      captureRef.current = null;
      const player = playerRef.current;
      playerRef.current = null;
      if (player?.destroy) player.destroy();
      // YouTube may replace its mount node with an iframe; clear only inside
      // the stable React-owned container after the player has been destroyed.
      playerContainerRef.current?.replaceChildren();
    };
  }, [selectedId, parsed?.videoId, startSeconds, endSeconds]);

  useEffect(() => {
    if (activeBlockIndex !== null) {
      exercisePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeBlockIndex]);

  useEffect(() => {
    if (!playerReady) {
      setRemainingSeconds(null);
      return undefined;
    }

    const updateCountdown = () => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== "function") return;
      const duration = Number(player.getDuration?.() || 0);
      const currentTime = Number(player.getCurrentTime() || 0);
      const configuredEnd = endSeconds !== null && endSeconds > startSeconds
        ? endSeconds
        : duration;
      const targetEnd = duration > 0 ? Math.min(configuredEnd || duration, duration) : configuredEnd;
      if (targetEnd > 0) {
        setRemainingSeconds(Math.max(0, Math.ceil(targetEnd - currentTime)));
      }
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [playerReady, selectedId, startSeconds, endSeconds]);

  useEffect(() => {
    if (!trainingStarted || activeBlockIndex !== null || !playerReady) return undefined;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const nextBlock = trainingBlocks[blockIndex];
      if (!player || !nextBlock || typeof player.getCurrentTime !== "function") return;
      if (player.getCurrentTime() >= nextBlock.end) {
        player.pauseVideo();
        setActiveBlockIndex(blockIndex);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [trainingStarted, activeBlockIndex, playerReady, blockIndex, trainingBlocks]);

  const evaluateAnswer = useCallback((answer) => {
    if (!activeBlock) return;
    if (normalizeText(answer) === normalizeText(activeBlock.text)) {
      setVoiceError("");
      setAnswerResult("correct");
    } else {
      setAnswerResult("incorrect");
      setVoiceError("Ответ отличается от оригинала. Исправь буквы прямо в полях слов.");
    }
  }, [selectedId, activeBlock?.id]);

  useEffect(() => {
    Object.values(revealTimerRefs.current).forEach((timer) => window.clearTimeout(timer));
    revealTimerRefs.current = {};
    setRevealedSentences({});
    setHintsRemaining(2);
  }, [activeBlock?.id, exerciseSentences.length]);

  function useHint(sentenceIndex) {
    if (hintsRemaining <= 0 || revealedSentences[sentenceIndex]) return;
    setHintsRemaining((remaining) => Math.max(0, remaining - 1));
    setRevealedSentences((current) => ({ ...current, [sentenceIndex]: true }));
    window.clearTimeout(revealTimerRefs.current[sentenceIndex]);
    revealTimerRefs.current[sentenceIndex] = window.setTimeout(() => {
      setRevealedSentences((current) => ({ ...current, [sentenceIndex]: false }));
      delete revealTimerRefs.current[sentenceIndex];
    }, 3000);
  }

  useEffect(() => () => {
    Object.values(revealTimerRefs.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  function updateVideoWordAnswer(token, nextValue) {
    const nextAnswers = { ...videoWordAnswers, [token.id]: nextValue };
    setVideoWordAnswers(nextAnswers);
    setVoiceError("");
    setAnswerResult("");

    const assembled = exerciseSentences.map((sentence) => sentence.tokens.map((part) => {
      if (!part.isWord) return part.value;
      return (nextAnswers[part.id] || []).join("");
    }).join("")).join(" ");

    const complete = exerciseWordTokens.every((word) => {
      const letters = nextAnswers[word.id] || [];
      return letters.length === [...word.value].length && letters.every(Boolean);
    });

    if (complete) {
      if (normalizeText(assembled) === normalizeText(activeBlock?.text)) {
        setAnswerResult("correct");
        setVoiceError("");
      } else {
        setAnswerResult("incorrect");
      }
    }
  }

  const startVoiceCapture = useCallback((sentence, sentenceIndex) => {
    if (!activeBlock || !sentence) return;
    setReplayingBlock(false);
    setReplayingSentenceIndex(null);
    playerRef.current?.pauseVideo();
    captureRef.current?.stop();
    setRecordingSentenceIndex(sentenceIndex);
    setSentenceVoiceAnswers((current) => ({ ...current, [sentenceIndex]: "" }));
    setVoiceError("");
    const capture = startAutoVoiceCapture({
      onStatus: setVoiceStatus,
      onError: (message) => { setVoiceError(message); setRecordingSentenceIndex(null); },
      onText: (recognizedText) => {
        setSentenceVoiceAnswers((current) => ({ ...current, [sentenceIndex]: recognizedText }));
        setRecordingSentenceIndex(null);
        if (normalizeText(recognizedText) === normalizeText(sentence.text)) {
          setVoiceError("");
        } else {
          setVoiceError("Ответ в предложении " + (sentenceIndex + 1) + " отличается от оригинала.");
        }
      },
    });
    captureRef.current = capture;
    capture.start();
  }, [selectedId, activeBlock?.id]);

  useEffect(() => {
    if (replayingSentenceIndex === null || !activeBlock) return undefined;
    const sentence = exerciseSentences[replayingSentenceIndex];
    if (!sentence) return undefined;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player && typeof player.getCurrentTime === "function" &&
          player.getCurrentTime() >= sentence.end + 0.1) {
        player.pauseVideo();
        setReplayingSentenceIndex(null);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [replayingSentenceIndex, selectedId, activeBlock?.id, exerciseSentences]);

  function replaySentence(sentence, sentenceIndex) {
    if (!sentence || !playerRef.current) return;
    captureRef.current?.stop();
    captureRef.current = null;
    setRecordingSentenceIndex(null);
    setVoiceStatus("idle");
    setReplayingBlock(false);
    setReplayingSentenceIndex(sentenceIndex);
    playerRef.current.pauseVideo();
    // Replay the exact subtitle cue interval supplied by YouTube.
    playerRef.current.seekTo(sentence.start, true);
    playerRef.current.playVideo();
  }

  function startTraining() {
    if (!playerReady || !playerRef.current || !trainingBlocks.length) return;
    captureRef.current?.stop();
    setBlockIndex(0);
    setActiveBlockIndex(null);
    setVoiceAnswer("");
    setVoiceError("");
    setAnswerResult("");
    setVideoWordAnswers({});
    setTrainingStarted(true);
    playerCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    playerRef.current.seekTo(startSeconds, true);
    playerRef.current.playVideo();
  }

  function continueVideo() {
    const completedIndex = activeBlockIndex;
    captureRef.current?.stop();
    captureRef.current = null;
    setActiveBlockIndex(null);
    setBlockIndex(completedIndex + 1);
    setVoiceStatus("idle");
    setVoiceAnswer("");
    setVoiceError("");
    setAnswerResult("");
    setVideoWordAnswers({});
    setReplayingBlock(false);
    playerRef.current?.playVideo();
  }

  // After each correct block, continue the video. Completing the last block
  // marks this video as done, celebrates, and returns to the library top.
  useEffect(() => {
    if (answerResult !== "correct" || activeBlockIndex === null) return undefined;
    const timer = window.setTimeout(() => {
      if (activeBlockIndex < trainingBlocks.length - 1) {
        continueVideo();
        return;
      }
      captureRef.current?.stop();
      captureRef.current = null;
      playerRef.current?.pauseVideo();
      setShowCompletion(true);
      window.setTimeout(() => {
        onCompleteVideo(selectedId);
        setShowCompletion(false);
        setSelectedId("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 2600);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [answerResult, activeBlockIndex, trainingBlocks.length, selectedId, onCompleteVideo]);


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
        <p className="video-intro">Смотри видео и восстанавливай на слух фрагменты диалога.</p>
      </div>
      <span className="video-heading-icon" aria-hidden="true">▶</span>
    </div>
    <div className="video-library-progress" role="status">
      <span>Выполнено заданий</span>
      <strong>{videos.filter((item) => completedVideoIds.includes(item.id)).length} из {videos.length}</strong>
      <div className="video-library-progress-track"><span style={{ width: `${videos.length ? (videos.filter((item) => completedVideoIds.includes(item.id)).length / videos.length) * 100 : 0}%` }} /></div>
    </div>
    <div className="video-library-list" aria-label="Библиотека видео">
      {videos.map((item) => {
        const itemVideoId = parseYouTubeUrl(item.url).videoId;
        return (
          <button type="button" key={item.id}
            className={"video-library-item " + (selectedVideo?.id === item.id ? "selected" : "")}
            onClick={() => { setSelectedId(item.id); setShowCompletion(false); }}
            aria-pressed={selectedVideo?.id === item.id}>
            <span className="video-library-thumbnail">
              {itemVideoId
                ? <img src={"https://img.youtube.com/vi/" + itemVideoId + "/mqdefault.jpg"} alt="" loading="lazy" />
                : <span className="video-library-thumbnail-fallback">▶</span>}
              <span className="video-library-play" aria-hidden="true">▶</span>
            </span>
            <span className="video-library-title">
              <strong>{item.title}</strong>
              <small>{item.level || "B1"} · YouTube</small>
              {completedVideoIds.includes(item.id) && <span className="video-library-completed">✓ Задание выполнено</span>}
            </span>
          </button>
        );
      })}
    </div>
    {showCompletion && <div className="video-completion-screen" role="status" aria-live="assertive">
      <div className="video-completion-fireworks" aria-hidden="true">🎉 ✨ 🎊 ✨ 🎉</div>
      <h2>ЗАДАНИЕ ВЫПОЛНЕНО!</h2>
      <p>Отличная работа!</p>
    </div>}
    {selectedVideo && parsed?.error ? <p className="video-error" role="alert">{parsed.error}</p> : selectedVideo && <>
      <div className="video-training-player-card">
      <section className="video-exercise-panel video-training-panel" ref={exercisePanelRef}>
        <div className="video-mask-heading">
          <h3>Тренировка аудирования</h3>
        </div>
        {!subtitleCues.length ? (
          <p className="video-training-note">Для этого ролика ещё не загружены субтитры. Сначала получи английские субтитры в админке.</p>
        ) : !trainingBlocks.length ? (
          <p className="video-training-note">В выбранном фрагменте недостаточно текста для заданий. Проверь субтитры или выбери другой отрезок.</p>
        ) : activeBlock ? (
          <>
            <div className="video-training-mask" aria-label="Предложения с замаскированными буквами">
              {exerciseSentences.map((sentence, sentenceIndex) => (
                <div className={"video-training-sentence-card" + (answerResult === "correct" ? " is-correct" : "")} key={sentenceIndex}>
                  {answerResult === "correct" && <div className="feedback-fireworks" aria-hidden="true">
                    <div className="fireworks">
                      <span className="firework" style={{ "--fireworks-x": "18%", "--fireworks-y": "35%" }} />
                      <span className="firework firework-two" style={{ "--fireworks-x": "78%", "--fireworks-y": "28%" }} />
                      <span className="firework firework-three" style={{ "--fireworks-x": "52%", "--fireworks-y": "72%" }} />
                    </div>
                    <div className="confetti">
                      {Array.from({ length: 28 }, (_, index) => <span key={index} style={{ left: ((index * 37) % 100) + "%", "--fall-duration": (1.1 + (index % 5) * 0.16) + "s", animationDelay: ((index % 7) * 0.07) + "s" }} />)}
                    </div>
                  </div>}
                  <div className="video-training-sentence">
                    <span className="video-training-sentence-number">{sentenceIndex + 1}.</span>
                    <div className="video-training-sentence-text">
                      {sentence.tokens.map((token) => {
                        if (!token.isWord) return <span key={token.id}>{token.value}</span>;
                        const wordIndex = exerciseWordTokens.findIndex((word) => word.id === token.id);
                        const isRevealed = Boolean(revealedSentences[sentenceIndex]);
                        const typedLetters = videoWordAnswers[token.id] || Array([...token.value].length).fill("");
                        return <WordGap key={token.id}
                          sentence={{ id: activeBlock.id + "-" + token.id, word: token.value }}
                          value={isRevealed ? [...token.value] : typedLetters}
                          onChange={(nextValue) => updateVideoWordAnswer(token, nextValue)}
                          disabled={answerResult === "correct" || isRevealed}
                          autoFocus={false}
                          nextInputRef={wordInputRefs.current[wordIndex + 1]}
                          firstInputRef={wordInputRefs.current[wordIndex]}
                          lastInputRef={wordLastInputRefs.current[wordIndex]}
                          previousWordValue={wordIndex > 0 ? (videoWordAnswers[exerciseWordTokens[wordIndex - 1].id] || Array([...exerciseWordTokens[wordIndex - 1].value].length).fill("")) : null}
                          previousWordOnChange={wordIndex > 0 ? (nextValue) => updateVideoWordAnswer(exerciseWordTokens[wordIndex - 1], nextValue) : null}
                          previousWordLastInputRef={wordIndex > 0 ? wordLastInputRefs.current[wordIndex - 1] : null}
                          showMistakes={answerResult === "incorrect"}
                          openedPositions={openedPositions[token.id]} />;
                      })}
                    </div>
                  </div>
                  <div className="video-sentence-actions">
                    <button className={`button button-secondary${replayingSentenceIndex === sentenceIndex ? " is-active" : ""}`} type="button"
                      onClick={() => replaySentence(sentence, sentenceIndex)}
                      disabled={replayingSentenceIndex === sentenceIndex}>
                      <><svg className="video-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.9 9a7.5 7.5 0 0 1 12.6-3L20 12M4 17v-5h5M19.1 15a7.5 7.5 0 0 1-12.6 3L4 12" /></svg><span>{replayingSentenceIndex === sentenceIndex ? "Прослушивание…" : "Прослушать ещё раз"}</span></>
                    </button>
                    <button className={`button button-secondary${revealedSentences[sentenceIndex] ? " is-active" : ""}`} type="button"
                      onClick={() => useHint(sentenceIndex)}
                      disabled={hintsRemaining <= 0 || Boolean(revealedSentences[sentenceIndex])}>
                      <><svg className="video-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></svg><span>{revealedSentences[sentenceIndex] ? "Подсказка использована" : `Подсказка · осталось ${hintsRemaining}`}</span></>
                    </button>
                    <button className={`button button-secondary${recordingSentenceIndex === sentenceIndex ? " is-active" : ""}`} type="button"
                      onClick={() => startVoiceCapture(sentence, sentenceIndex)}
                      disabled={voiceStatus === "listening" || voiceStatus === "transcribing"}>
                      <><svg className="video-action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3M9 21.5h6" /></svg><span>{recordingSentenceIndex === sentenceIndex ? "Говорите…" : "Записать ответ"}</span></>
                    </button>
                  </div>
                  {sentenceVoiceAnswers[sentenceIndex] && (
                    <p className={"video-voice-answer" + (normalizeText(sentenceVoiceAnswers[sentenceIndex]) === normalizeText(sentence.text) ? "" : " is-incorrect")}>
                      Распознано: {sentenceVoiceAnswers[sentenceIndex]}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="video-voice-indicator" role="status" aria-live="polite">
              <span className={"auto-voice-dot" + (voiceStatus === "listening" ? " is-listening" : "")} />
              {voiceStatus === "listening" ? "Микрофон активен — произнесите предложение…" :
                voiceStatus === "transcribing" ? "Whisper распознаёт вашу речь…" :
                  answerResult === "correct" ? "Все слова восстановлены правильно." : "Заполните поля текстом или голосом."}
            </div>
            {voiceError && <p className="video-voice-error" role="alert">{voiceError}</p>}
            {voiceAnswer && <p className={"video-voice-answer" + (answerResult === "incorrect" ? " is-incorrect" : "")}>Распознано: {voiceAnswer}</p>}
            {voiceError && <p className="video-voice-error" role="alert">{voiceError}</p>}
            {answerResult === "incorrect" && <p className="video-voice-error" role="alert">Есть ошибки. Исправь буквы прямо в полях слов.</p>}
            {answerResult === "correct" && (
              <div className="video-exercise-actions">
                <p className="video-training-note">
                  {activeBlockIndex < trainingBlocks.length - 1
                    ? "Отлично! Переходим к заданию " + (activeBlockIndex + 2) + "…"
                    : "Отлично! Продолжаем просмотр видео…"}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="video-exercise-actions">
              {!trainingStarted && (
                <button className="button button-primary" type="button" disabled={!playerReady} onClick={startTraining}>
                  Начать тренировку
                </button>
              )}
              {trainingStarted && <span className="video-training-progress">Задание {Math.min(blockIndex + 1, trainingBlocks.length)} из {trainingBlocks.length}</span>}
            </div>
            {trainingStarted && blockIndex >= trainingBlocks.length && (
              <p className="video-training-note video-training-complete">Все задания пройдены. Видео продолжает воспроизводиться.</p>
            )}
          </>
        )}
      </section>

      <div className="video-player-card video-player-youtube" ref={playerCardRef}>
        <div className="video-player-topline"><strong>{selectedVideo.title}</strong><span>{selectedVideo.level || "B1"}</span></div>
        <div className="video-frame-wrap">
          <div className="video-youtube-player" key={selectedId + "-" + parsed.videoId + "-" + startSeconds + "-" + (endSeconds || "end")} ref={playerContainerRef} />
          {remainingSeconds !== null && (
            <div className="video-countdown" aria-label={"Осталось " + formatRemainingTime(remainingSeconds)}>
              Осталось {formatRemainingTime(remainingSeconds)}
            </div>
          )}
        </div>
        <a className="video-original-link" href={parsed.originalUrl} target="_blank" rel="noreferrer">Открыть оригинал ↗</a>
      </div>
      </div>

      {playerError && <p className="video-error" role="alert">{playerError}</p>}

    </>}
    <p className="video-legal-note">Используются только субтитры, которые YouTube отдаёт для выбранного ролика. Само видео не скачивается.</p>
  </section>;
}
