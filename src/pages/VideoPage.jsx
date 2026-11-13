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

function buildTrainingBlocks(cues, startSeconds, endSeconds) {
  const inRange = [...cues]
    .filter((cue) => Number(cue.start) < (endSeconds ?? Infinity) && Number(cue.end) > startSeconds)
    .sort((a, b) => Number(a.start) - Number(b.start));

  const sentences = [];
  let buffer = "";
  let bufferStart = null;
  let previousCueEnd = null;

  const finishBuffer = (end) => {
    const text = buffer.trim();
    if (text) sentences.push({ text, start: bufferStart ?? startSeconds, end });
    buffer = "";
    bufferStart = null;
  };

  for (const cue of inRange) {
    const cueStart = Number(cue.start);
    const cueEnd = Number(cue.end);
    const cueText = String(cue.text || "").trim();
    if (!cueText || !Number.isFinite(cueStart) || !Number.isFinite(cueEnd)) continue;

    if (buffer && previousCueEnd !== null && cueStart - previousCueEnd > 2.2) {
      finishBuffer(previousCueEnd);
    }

    const pieces = cueText.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [cueText];
    for (const piece of pieces) {
      const part = piece.trim();
      if (!part) continue;
      if (!buffer) bufferStart = cueStart;
      buffer = buffer ? buffer + " " + part : part;
      if (/[.!?]["')\]]*$/.test(part)) finishBuffer(cueEnd);
    }
    previousCueEnd = cueEnd;
  }
  if (buffer) finishBuffer(previousCueEnd ?? startSeconds);

  const blocks = [];
  let sentenceIndex = 0;

  while (sentenceIndex < sentences.length) {
    const group = [sentences[sentenceIndex], sentences[sentenceIndex + 1]].filter(Boolean);
    sentenceIndex += group.length;

    const countWords = () => (group.map((sentence) => sentence.text).join(" ").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).filter((word) => (word.match(/[\p{L}\p{N}]/gu) || []).length >= 3).length;

    // Start with two sentences. If they are too short, keep adding the
    // following sentences until the whole exercise contains more than 20 words.
    while (group.length >= 2 && countWords() <= 10 && sentenceIndex < sentences.length) {
      group.push(sentences[sentenceIndex]);
      sentenceIndex += 1;
    }

    const text = group.map((sentence) => sentence.text).join(" ");
    const wordCount = countWords();
    if (group.length >= 2 && wordCount > 10) {
      blocks.push({
        id: "group-" + (sentenceIndex - group.length),
        text,
        sentences: group,
        start: group[0].start,
        end: group[group.length - 1].end,
        wordCount,
      });
    }
  }
  return blocks;
}

export default function VideoPage({ videos = [] }) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id || "");
  const selectedVideo = videos.find((item) => item.id === selectedId) || videos[0] || null;
  const parsed = useMemo(() => selectedVideo ? parseYouTubeUrl(selectedVideo.url) : null, [selectedVideo?.url]);
  const startSeconds = parseVideoTime(selectedVideo?.startTime);
  const endSeconds = selectedVideo?.endTime ? parseVideoTime(selectedVideo.endTime) : null;
  const subtitleCues = Array.isArray(selectedVideo?.subtitleCues) ? selectedVideo.subtitleCues : [];
  const trainingBlocks = useMemo(
    () => buildTrainingBlocks(subtitleCues, startSeconds, endSeconds),
    [selectedId, subtitleCues, startSeconds, endSeconds]
  );

  const playerContainerRef = useRef(null);
  const playerRef = useRef(null);
  const captureRef = useRef(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [trainingStarted, setTrainingStarted] = useState(false);
  const [blockIndex, setBlockIndex] = useState(0);
  const [activeBlockIndex, setActiveBlockIndex] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceAnswer, setVoiceAnswer] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [answerResult, setAnswerResult] = useState("");
  const [videoWordAnswers, setVideoWordAnswers] = useState({});
  const [replayingBlock, setReplayingBlock] = useState(false);
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
            controls: 1,
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
    if (!trainingStarted || activeBlockIndex !== null || !playerReady) return undefined;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const nextBlock = trainingBlocks[blockIndex];
      if (!player || !nextBlock || typeof player.getCurrentTime !== "function") return;
      if (player.getCurrentTime() >= nextBlock.end + 0.12) {
        player.pauseVideo();
        setActiveBlockIndex(blockIndex);
      }
    }, 100);
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

  const startVoiceCapture = useCallback(() => {
    if (!activeBlock) return;
    setReplayingBlock(false);
    playerRef.current?.pauseVideo();
    captureRef.current?.stop();
    setVoiceAnswer("");
    setVoiceError("");
    setAnswerResult("");
    const capture = startAutoVoiceCapture({
      onStatus: setVoiceStatus,
      onError: (message) => setVoiceError(message),
      onText: (recognizedText) => {
        setVoiceAnswer(recognizedText);
        evaluateAnswer(recognizedText);
      },
    });
    captureRef.current = capture;
    capture.start();
  }, [selectedId, activeBlock?.id, evaluateAnswer]);

  useEffect(() => {
    if (!replayingBlock || !activeBlock) return undefined;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player && typeof player.getCurrentTime === "function" &&
          player.getCurrentTime() >= activeBlock.end) {
        player.pauseVideo();
        setReplayingBlock(false);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [replayingBlock, selectedId, activeBlock?.id]);

  function replayActiveBlock() {
    if (!activeBlock || !playerRef.current) return;
    captureRef.current?.stop();
    captureRef.current = null;
    setVoiceStatus("idle");
    setReplayingBlock(false);
    playerRef.current.pauseVideo();
    playerRef.current.seekTo(activeBlock.start, true);
    setReplayingBlock(true);
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
        <p className="video-intro">Смотри видео и восстанавливай на слух длинные фрагменты диалога.</p>
      </div>
      <span className="video-heading-icon" aria-hidden="true">▶</span>
    </div>
    <div className="video-library-list" aria-label="Библиотека видео">
      {videos.map((item) => {
        const itemVideoId = parseYouTubeUrl(item.url).videoId;
        return (
          <button type="button" key={item.id}
            className={"video-library-item " + (selectedVideo?.id === item.id ? "selected" : "")}
            onClick={() => setSelectedId(item.id)}
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
            </span>
          </button>
        );
      })}
    </div>
    {selectedVideo && parsed?.error ? <p className="video-error" role="alert">{parsed.error}</p> : selectedVideo && <>
      <div className="video-player-card video-player-youtube">
        <div className="video-player-topline"><strong>{selectedVideo.title}</strong><span>{selectedVideo.level || "B1"}</span></div>
        <div className="video-frame-wrap">
          <div className="video-youtube-player" key={selectedId + "-" + parsed.videoId + "-" + startSeconds + "-" + (endSeconds || "end")} ref={playerContainerRef} />
        </div>
        <a className="video-original-link" href={parsed.originalUrl} target="_blank" rel="noreferrer">Открыть оригинал ↗</a>
      </div>

      {playerError && <p className="video-error" role="alert">{playerError}</p>}
      <section className="video-exercise-panel video-training-panel">
        <div className="video-mask-heading">
          <h3>Тренировка аудирования</h3>
          <span>минимум 2 предложения · больше 10 слов</span>
        </div>
        {!subtitleCues.length ? (
          <p className="video-training-note">Для этого ролика ещё не загружены субтитры. Сначала получи английские субтитры в админке.</p>
        ) : !trainingBlocks.length ? (
          <p className="video-training-note">В выбранном фрагменте недостаточно текста для задания длиннее 10 слов. Проверь субтитры или выбери другой отрезок.</p>
        ) : activeBlock ? (
          <>
            <div className="video-training-mask" aria-label="Предложения с замаскированными буквами">
              {exerciseSentences.map((sentence, sentenceIndex) => (
                <div className="video-training-sentence" key={sentenceIndex}>
                  <span className="video-training-sentence-number">{sentenceIndex + 1}.</span>
                  <div className="video-training-sentence-text">
                    {sentence.tokens.map((token) => {
                      if (!token.isWord) return <span key={token.id}>{token.value}</span>;
                      return <WordGap key={token.id}
                        sentence={{ id: activeBlock.id + "-" + token.id, word: token.value }}
                        value={videoWordAnswers[token.id] || Array([...token.value].length).fill("")}
                        onChange={(nextValue) => updateVideoWordAnswer(token, nextValue)}
                        disabled={answerResult === "correct"}
                        autoFocus={false}
                        showMistakes={answerResult === "incorrect"}
                        openedPositions={openedPositions[token.id]} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="video-exercise-actions video-training-controls">
              <button className="button button-secondary" type="button" onClick={replayActiveBlock} disabled={replayingBlock}>
                <span aria-hidden="true">↻</span> {replayingBlock ? "Прослушивание…" : "Прослушать фрагмент ещё раз"}
              </button>
              <button className="button button-secondary" type="button" onClick={startVoiceCapture} disabled={voiceStatus === "listening" || voiceStatus === "transcribing"}>
                <span aria-hidden="true">🎙</span> Записать ответ
              </button>
            </div>
            <div className={"video-voice-indicator" + (voiceStatus === "listening" ? " is-listening" : "")} role="status" aria-live="polite">
              <span className={"auto-voice-dot" + (voiceStatus === "listening" ? " is-listening" : "")} />
              {voiceStatus === "listening" ? "Микрофон активен — произнесите предложения…" :
                voiceStatus === "transcribing" ? "Whisper распознаёт вашу речь…" :
                  answerResult === "correct" ? "Ответ распознан правильно." : "Микрофон включается только после нажатия «Записать ответ»."}
            </div>
            {voiceAnswer && <p className={"video-voice-answer" + (answerResult === "incorrect" ? " is-incorrect" : "")}>Распознано: {voiceAnswer}</p>}
            {voiceError && <p className="video-voice-error" role="alert">{voiceError}</p>}
            {answerResult === "incorrect" && <p className="video-voice-error" role="alert">Есть ошибки. Исправь буквы прямо в полях слов.</p>}
            {answerResult === "correct" && (
              <div className="video-exercise-actions">
                <button className="button button-primary" type="button" onClick={continueVideo}>Продолжить просмотр</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="video-exercise-actions">
              <button className="button button-primary" type="button" disabled={!playerReady} onClick={startTraining}>
                {trainingStarted && blockIndex < trainingBlocks.length ? "Продолжить тренировку" : trainingStarted ? "Начать заново" : "Начать тренировку"}
              </button>
              {trainingStarted && <span className="video-training-progress">Задание {Math.min(blockIndex + 1, trainingBlocks.length)} из {trainingBlocks.length}</span>}
            </div>
            {trainingStarted && blockIndex >= trainingBlocks.length && (
              <p className="video-training-note video-training-complete">Все задания пройдены. Видео продолжает воспроизводиться.</p>
            )}
          </>
        )}
      </section>
    </>}
    <p className="video-legal-note">Используются только субтитры, которые YouTube отдаёт для выбранного ролика. Само видео не скачивается.</p>
  </section>;
}
