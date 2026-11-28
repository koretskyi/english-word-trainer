import { useEffect, useMemo, useRef, useState } from "react";
import WordGap, { createWordGapOpenedPositions } from "../components/LetterGap.jsx";
import CorrectFeedback from "../components/CorrectFeedback.jsx";
import { startAutoVoiceCapture } from "../utils/autoVoice.js";

// Та же загрузка иллюстрации через backend /api/word-image, что и на вкладке «Слова».
function AuditionWordImage({ sentence }) {
  const word = sentence?.word;
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!word) {
      setImage(null);
      setStatus("empty");
      return undefined;
    }
    const controller = new AbortController();
    setImage(null);
    setStatus("loading");
    async function loadImage() {
      try {
        const response = await fetch("/api/word-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            word,
            context: sentence?.pixabayQuery ?? String(sentence?.englishTemplate || "").replace("{word}", word),
          }),
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") || "";
        const body = await response.text();
        let data = {};
        if (contentType.includes("application/json")) {
          try { data = JSON.parse(body); }
          catch { throw new Error("Повреждённый ответ сервера изображений"); }
        } else {
          throw new Error(`Сервер изображений вернул не JSON (HTTP ${response.status})`);
        }
        if (!response.ok) throw new Error(data.detail || `Image API HTTP ${response.status}`);
        setImage(data);
        setStatus("ready");
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Не удалось загрузить иллюстрацию аудирования:", error);
          setImage(null);
          setStatus("error");
        }
      }
    }
    loadImage();
    return () => controller.abort();
  }, [word, sentence?.pixabayQuery, sentence?.englishTemplate]);

  if (status === "loading") return <div className="word-image-placeholder" aria-live="polite">Подбираю изображение…</div>;
  if (status !== "ready" || !image?.src) return <div className="word-image-placeholder is-empty">Иллюстрация пока не найдена</div>;
  return <figure className="word-image-card"><img src={image.src} alt={`Иллюстрация к предложению: ${word}`} loading="eager"
    onError={() => { setImage(null); setStatus("error"); }} /></figure>;
}

function getSentenceText(sentence) {
  if (!sentence) return "";
  return (sentence.englishTemplate || "")
    .replace("{word}", sentence.word || "")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s*\.$/, "");
}

// Маскируем каждое слово общим WordGap — тем же компонентом, что и в режиме «Слова».
function createAuditionMask(text) {
  return (text.match(/[A-Za-z]+|[^A-Za-z]+/g) || []).map((part, tokenIndex) => ({
    id: `token-${tokenIndex}`,
    value: part,
    isWord: /^[A-Za-z]/.test(part),
  }));
}

function normalizeSentence(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speakAuditionSentence(text, onFinished, onError) {
  if (!text || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (onFinished) {
    utterance.onend = onFinished;
    utterance.onerror = (event) => {
      // React StrictMode and card cleanup can cancel an utterance after playback has started.
      // These expected cancellations must not be shown as a playback failure.
      if (event?.error === "canceled" || event?.error === "interrupted") return;
      onError?.(event);
    };
  }
  const englishVoices = window.speechSynthesis.getVoices()
    .filter((voice) => /^en(-|_)/i.test(voice.lang));
  const preferredVoice =
    englishVoices.find((voice) => /microsoft.*jenny|jenny.*microsoft/i.test(voice.name)) ||
    englishVoices.find((voice) => /jenny/i.test(voice.name)) ||
    englishVoices.find((voice) => /aria|samantha|ava|zira|susan|karen|victoria|female/i.test(voice.name)) ||
    englishVoices.find((voice) => /^en-US/i.test(voice.lang)) ||
    englishVoices.find((voice) => /^en-GB/i.test(voice.lang)) ||
    englishVoices[0];

  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.lang = preferredVoice?.lang || "en-US";
  utterance.rate = 0.9;
  utterance.pitch = 1.08;
  window.speechSynthesis.speak(utterance);
  return true;
}

export default function AuditionPage({ sentences, selectedLevel, setSelectedLevel, levels, audioEnabled }) {
  const filteredSentences = useMemo(
    () => (Array.isArray(sentences) ? sentences : [])
      .filter((item) => item && item.level === selectedLevel && item.word && item.englishTemplate),
    [sentences, selectedLevel]
  );
  const [cardIndex, setCardIndex] = useState(0);
  const [voiceAnswer, setVoiceAnswer] = useState("");
  const [result, setResult] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [dontKnowCountdown, setDontKnowCountdown] = useState(null);
  const [autoVoiceStatus, setAutoVoiceStatus] = useState("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [voiceConfetti, setVoiceConfetti] = useState(false);
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voicePreparing, setVoicePreparing] = useState(false);
  const [voiceCountdown, setVoiceCountdown] = useState(0);
  const autoVoiceRef = useRef(null);
  const confettiTimerRef = useRef(null);
  const manualInputRef = useRef(false);
  const retryTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const voiceAttemptIdRef = useRef(0);
  const voiceModeActiveRef = useRef(false);
  const wordInputRefs = useRef([]);
  const sentence = filteredSentences.length
    ? filteredSentences[cardIndex % filteredSentences.length]
    : null;
  const englishText = getSentenceText(sentence);
  const [maskedTokens, setMaskedTokens] = useState(() => createAuditionMask(englishText));
  const [wordAnswers, setWordAnswers] = useState({});

  const wordTokens = maskedTokens.filter((token) => token.isWord);
  // В аудировании заранее создаём независимые подсказки для каждого слова карточки.
  const openedPositionsByToken = useMemo(
    () => Object.fromEntries(
      wordTokens.map((token) => [token.id, createWordGapOpenedPositions(token.value)])
    ),
    [sentence?.id, englishText, maskedTokens]
  );
  useEffect(() => {
    setCardIndex(0);
  }, [selectedLevel]);

  useEffect(() => {
    manualInputRef.current = false;
    voiceModeActiveRef.current = false;
    voiceAttemptIdRef.current += 1;
    window.clearTimeout(retryTimerRef.current);
    window.clearTimeout(countdownTimerRef.current);
    autoVoiceRef.current?.stop();
    autoVoiceRef.current = null;
    setAutoVoiceStatus("idle");
    setMicLevel(0);
    setVoiceConfetti(false);
    setVoiceModeActive(false);
    setVoicePreparing(false);
    setVoiceCountdown(0);
    window.clearTimeout(confettiTimerRef.current);
    setVoiceAnswer("");
    setResult("");
    setSpeechError("");
    setDontKnowCountdown(null);
    setWordAnswers({});
    setMaskedTokens(createAuditionMask(englishText));
    wordInputRefs.current = [];
  }, [sentence?.id, englishText]);

  // «Не знаю» показывает правильное предложение на 3 секунды,
  // затем возвращает пустые поля. Голосовой режим не запускается.
  useEffect(() => {
    if (dontKnowCountdown === null) return undefined;
    const timer = window.setTimeout(() => {
      if (dontKnowCountdown <= 1) {
        setDontKnowCountdown(null);
        setWordAnswers({});
        setResult("");
      } else {
        setDontKnowCountdown((current) => current === null ? null : current - 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dontKnowCountdown]);

  function beginVoiceCountdown(onComplete) {
    window.clearTimeout(countdownTimerRef.current);
    setVoicePreparing(true);
    setVoiceCountdown(3);
    let remaining = 3;
    const tick = () => {
      countdownTimerRef.current = window.setTimeout(() => {
        remaining -= 1;
        if (remaining > 0) {
          setVoiceCountdown(remaining);
          tick();
          return;
        }
        countdownTimerRef.current = null;
        setVoiceCountdown(0);
        setVoicePreparing(false);
        onComplete();
      }, 1000);
    };
    tick();
  }

  function scheduleVoiceRetry(message = "Запись не распознана") {
    if (!voiceModeActiveRef.current) return;
    setAutoVoiceStatus("idle");
    setMicLevel(0);
    setSpeechError(message);
    setVoicePreparing(false);
    setVoiceCountdown(0);
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      if (!voiceModeActiveRef.current) return;
      beginVoiceCountdown(() => {
        if (voiceModeActiveRef.current) startVoiceInput();
      });
    }, 1000);
  }

  function startContinuousVoiceMode() {
    if (!englishText || result === "correct") return;
    manualInputRef.current = false;
    voiceModeActiveRef.current = true;
    setVoiceModeActive(true);
    setSpeechError("");
    setVoiceAnswer("");
    window.clearTimeout(retryTimerRef.current);
    window.clearTimeout(countdownTimerRef.current);
    voiceAttemptIdRef.current += 1;
    autoVoiceRef.current?.stop();
    autoVoiceRef.current = null;
    beginVoiceCountdown(startVoiceInput);
  }

  function stopContinuousVoiceMode() {
    voiceModeActiveRef.current = false;
    voiceAttemptIdRef.current += 1;
    setVoiceModeActive(false);
    setVoicePreparing(false);
    setVoiceCountdown(0);
    window.clearTimeout(retryTimerRef.current);
    window.clearTimeout(countdownTimerRef.current);
    retryTimerRef.current = null;
    countdownTimerRef.current = null;
    autoVoiceRef.current?.stop();
    autoVoiceRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setAutoVoiceStatus("idle");
    setMicLevel(0);
  }

  function startVoiceInput() {
    if (!englishText || !voiceModeActiveRef.current || result === "correct") return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    const attemptId = ++voiceAttemptIdRef.current;
    autoVoiceRef.current?.stop();
    setSpeechError("");
    setVoiceAnswer("");
    setVoicePreparing(false);
    setVoiceCountdown(0);
    setAutoVoiceStatus("listening");
    const capture = startAutoVoiceCapture({
      expectedWord: englishText,
      transcriptionMode: "sentence",
      whisperModel: "medium",
      silenceMs: 900,
      maxRecordingMs: 20000,
      speechConfirmMs: 250,
      calibrationMs: 350,
      noSpeechTimeoutMs: 4000,
      onStatus: (status) => {
        if (attemptId !== voiceAttemptIdRef.current) return;
        setAutoVoiceStatus(status);
        if (status !== "listening") setMicLevel(0);
      },
      onLevel: (level) => {
        if (attemptId === voiceAttemptIdRef.current) setMicLevel(level);
      },
      onError: (message) => {
        if (attemptId !== voiceAttemptIdRef.current) return;
        scheduleVoiceRetry(message || "Не удалось записать звук. Повторная попытка…");
      },
      onNoSpeech: () => {
        if (attemptId !== voiceAttemptIdRef.current) return;
        scheduleVoiceRetry("Запись не распознана");
      },
      onText: (recognizedText) => {
        if (attemptId !== voiceAttemptIdRef.current || manualInputRef.current) return;
        const transcript = String(recognizedText || "").trim();
        setVoiceAnswer(transcript);
        setMicLevel(0);
        if (normalizeSentence(transcript) === normalizeSentence(englishText)) {
          setVoiceConfetti(true);
          window.clearTimeout(confettiTimerRef.current);
          confettiTimerRef.current = window.setTimeout(() => setVoiceConfetti(false), 1400);
          setWordAnswers(Object.fromEntries(wordTokens.map((token) => [token.id, [...token.value]])));
          setSpeechError("");
          setResult("correct");
          voiceModeActiveRef.current = false;
          setVoiceModeActive(false);
          setVoicePreparing(false);
          setVoiceCountdown(0);
          setAutoVoiceStatus("idle");
        } else {
          voiceModeActiveRef.current = false;
          setVoiceModeActive(false);
          setVoicePreparing(false);
          setVoiceCountdown(0);
          setAutoVoiceStatus("idle");
          setSpeechError("Предложение распознано не полностью или с ошибками. Попробуй ещё раз.");
          setResult("incorrect");
        }
      },
    });
    autoVoiceRef.current = capture;
    capture.start();
  }

  function playSentenceAndListen() {
    if (!englishText || result === "correct") return;
    // Playback is independent: the replay button must never activate the microphone.
    window.clearTimeout(retryTimerRef.current);
    window.clearTimeout(countdownTimerRef.current);
    retryTimerRef.current = null;
    countdownTimerRef.current = null;
    voiceAttemptIdRef.current += 1;
    autoVoiceRef.current?.stop();
    autoVoiceRef.current = null;
    voiceModeActiveRef.current = false;
    setVoiceModeActive(false);
    setVoicePreparing(false);
    setVoiceCountdown(0);
    setAutoVoiceStatus("speaking");
    setSpeechError("");
    const ok = speakAuditionSentence(englishText,
      () => setAutoVoiceStatus("idle"),
      () => {
        setAutoVoiceStatus("idle");
        setSpeechError("Не удалось озвучить предложение.");
      }
    );
    if (!ok) {
      setAutoVoiceStatus("idle");
      setSpeechError("Браузер не поддерживает озвучивание.");
    }
  }

  function updateWordAnswer(token, nextValue) {
    manualInputRef.current = true;
    stopContinuousVoiceMode();
    const nextAnswers = { ...wordAnswers, [token.id]: nextValue };
    setWordAnswers(nextAnswers);
    setVoiceAnswer("");
    setResult("");
    window.clearTimeout(retryTimerRef.current);

    const assembled = maskedTokens.map((part) => {
      if (!part.isWord) return part.value;
      return (nextAnswers[part.id] || []).join("");
    }).join("");

    const complete = wordTokens.every((word) => {
      const letters = nextAnswers[word.id] || [];
      return letters.length === [...word.value].length && letters.every(Boolean);
    });

    if (complete) {
      setResult(normalizeSentence(assembled) === normalizeSentence(englishText) ? "correct" : "incorrect");
    }
  }

  function handleDontKnow() {
    stopContinuousVoiceMode();
    manualInputRef.current = false;
    setVoiceAnswer("");
    setResult("");
    setSpeechError("");
    setDontKnowCountdown(3);
  }

  function nextCard() {
    setCardIndex((current) => (current + 1) % Math.max(1, filteredSentences.length));
  }

  if (!sentence) {
    return (
      <section className="panel audition-panel">
        <h2>Аудирование</h2>
        <p>На уровне {selectedLevel} пока нет предложений для аудирования.</p>
      </section>
    );
  }

  let wordIndex = 0;

  return (
    <section className={"panel audition-panel study-panel" + (result === "correct" ? " answer-correct" : "")}>
      <div className="audition-toolbar">
        <div className="level-selector">
          <label htmlFor="audition-level">Уровень:</label>
          <select id="audition-level" value={selectedLevel} onChange={(event) => setSelectedLevel(event.target.value)}>
            {levels.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </div>
        <span className="audition-counter">Предложение {cardIndex + 1} из {filteredSentences.length}</span>
      </div>

      <p className="eyebrow">ПРОСЛУШАЙ И ВОССТАНОВИ ПРЕДЛОЖЕНИЕ</p>

      <div className={`study-card-shell audition-card-shell${result === "correct" ? " is-answered" : ""}`}>
        <div className="study-card-image-slot audition-image-slot">
          <AuditionWordImage key={sentence.id} sentence={sentence} />
        </div>
        <div className="audition-mask" aria-label="Английское предложение с пропущенными буквами">
          {maskedTokens.map((token) => {
            if (!token.isWord) return <span key={token.id}>{token.value}</span>;

            const currentWordIndex = wordIndex++;
            if (!wordInputRefs.current[currentWordIndex]) {
              wordInputRefs.current[currentWordIndex] = { current: null };
            }
            if (!wordInputRefs.current[currentWordIndex + 1]) {
              wordInputRefs.current[currentWordIndex + 1] = { current: null };
            }
            const thisWordRef = wordInputRefs.current[currentWordIndex];
            const nextWordRef = wordInputRefs.current[currentWordIndex + 1];

            return (
              <WordGap
                key={`${sentence.id}-${token.id}`}
                sentence={{ id: `${sentence.id}-${token.id}`, word: token.value }}
                value={wordAnswers[token.id] || Array([...token.value].length).fill("")}
                onChange={(nextValue) => updateWordAnswer(token, nextValue)}
                disabled={result === "correct" || dontKnowCountdown !== null}
                autoFocus={currentWordIndex === 0}
                firstInputRef={thisWordRef}
                nextInputRef={nextWordRef}
                showMistakes={result === "incorrect"}
                openedPositions={openedPositionsByToken[token.id]}
                revealAll={dontKnowCountdown !== null}
              />
            );
          })}
        </div>

        {result === "correct" ? (
          <div className="answer-result-card is-correct" role="status" aria-live="polite">
            <CorrectFeedback />
            <button className="button button-primary" type="button" onClick={nextCard}>
              Следующее предложение
            </button>
          </div>
        ) : (
          <div className="study-card-footer">
            {voiceModeActive && (
              <p className="word-voice-status" role="status" aria-live="polite">
                <span className={`voice-speaking-indicator${autoVoiceStatus === "listening" ? " is-visible" : ""}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="3"/><path d="M5 20c.7-3.4 3.1-5 7-5s6.3 1.6 7 5"/><path d="M3 10v4m18-4v4"/></svg>
                </span>
                <span className={`voice-status-label${autoVoiceStatus === "listening" ? " is-speaking" : voicePreparing && voiceCountdown > 0 ? " is-countdown" : ""}`}>
                  {autoVoiceStatus === "listening" ? "Говорите" :
                    autoVoiceStatus === "transcribing" ? "Распознавание…" :
                    autoVoiceStatus === "speaking" ? "Слушайте предложение…" :
                    voicePreparing ? (speechError
                      ? `${speechError}. Новая запись через ${voiceCountdown}…`
                      : `Новая запись через ${voiceCountdown}…`) :
                    speechError || "Голосовой режим включён"}
                </span>
              </p>
            )}

            <div className="form-actions word-answer-actions">
              <button className={`button button-secondary word-microphone-button${voiceModeActive ? " is-preparing" : ""}${autoVoiceStatus === "listening" ? " is-listening" : ""}${autoVoiceStatus === "transcribing" ? " is-transcribing" : ""}`}
                type="button"
                onClick={voiceModeActive ? stopContinuousVoiceMode : startContinuousVoiceMode}
                disabled={result === "correct"}
                aria-label={voiceModeActive ? "Выйти из голосового режима" : "Ответить голосом"}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4m-4 0h8"/></svg>
                <span className="voice-button-label">{voiceModeActive ? "Выйти из режима" : "Ответить голосом"}</span>
              </button>
              <button className="button button-secondary" type="button" onClick={playSentenceAndListen} disabled={result === "correct"}>
                Прослушать ещё раз
              </button>
              <button className="button button-secondary button-dont-know" type="button" onClick={handleDontKnow}
                disabled={dontKnowCountdown !== null}>
                Не знаю
              </button>
            </div>

            {dontKnowCountdown !== null && (
              <div className="audition-countdown" role="status" aria-live="assertive">
                Ответ: {dontKnowCountdown}
              </div>
            )}
            {speechError && <p className="audition-speech-error" role="status">{speechError}</p>}
            {voiceAnswer && (
              <p className={`audition-voice-answer${normalizeSentence(voiceAnswer) !== normalizeSentence(englishText) ? " is-incorrect" : ""}`}>
                Распознано: {voiceAnswer}
              </p>
            )}
            {result === "incorrect" && (
              <div className="audition-feedback audition-feedback-incorrect" role="alert">
                <strong>Не совсем. Проверь все буквы и их порядок.</strong>
                <span>Исправь ошибки прямо в ячейках предложения или попробуй ответить голосом ещё раз.</span>
                {voiceAnswer && (
                  <button className="button button-primary voice-retry-button" type="button" onClick={startContinuousVoiceMode}>
                    Попробовать ещё раз
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
