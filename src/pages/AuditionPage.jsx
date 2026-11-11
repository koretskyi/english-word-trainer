import { useEffect, useMemo, useRef, useState } from "react";
import WordGap, { createWordGapOpenedPositions } from "../components/LetterGap.jsx";
import CorrectFeedback from "../components/CorrectFeedback.jsx";
import { startAutoVoiceCapture } from "../utils/autoVoice.js";

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
  const autoVoiceRef = useRef(null);
  const manualInputRef = useRef(false);
  const retryTimerRef = useRef(null);
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
    autoVoiceRef.current?.stop();
    autoVoiceRef.current = null;
    setAutoVoiceStatus("idle");
    setVoiceAnswer("");
    setResult("");
    setSpeechError("");
    setDontKnowCountdown(null);
    setWordAnswers({});
    setMaskedTokens(createAuditionMask(englishText));
    wordInputRefs.current = [];
  }, [sentence?.id, englishText]);

  // При «Не знаю» временно показываем полный ответ на 3 секунды,
  // затем снова скрываем буквы и разрешаем пользователю заполнить предложение.
  useEffect(() => {
    if (dontKnowCountdown === null) return undefined;
    const timer = window.setTimeout(() => {
      if (dontKnowCountdown <= 1) {
        setDontKnowCountdown(null);
        startAutomaticListening();
      } else {
        setDontKnowCountdown((current) => current === null ? null : current - 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dontKnowCountdown]);

  // Как и в режиме «Слова»: после правильного ответа автоматически открываем следующую карточку.
  useEffect(() => {
    if (result !== "correct") return undefined;
    const timer = window.setTimeout(() => {
      setCardIndex((current) => (current + 1) % Math.max(1, filteredSentences.length));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [result, filteredSentences.length]);

  function startAutomaticListening() {
    if (manualInputRef.current || !englishText) return;
    autoVoiceRef.current?.stop();
    const capture = startAutoVoiceCapture({
      onStatus: setAutoVoiceStatus,
      onError: setSpeechError,
      onText: (recognizedText) => {
        if (manualInputRef.current) return;
        setVoiceAnswer(recognizedText);
        if (normalizeSentence(recognizedText) === normalizeSentence(englishText)) {
          setSpeechError("");
          setResult("correct");
        } else {
          setSpeechError("Ответ неправильный. Микрофон включится снова через секунду.");
          setResult("");
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = window.setTimeout(() => {
            if (!manualInputRef.current) startAutomaticListening();
          }, 1000);
        }
      },
    });
    autoVoiceRef.current = capture;
    capture.start();
  }

  function playSentenceAndListen() {
    if (manualInputRef.current || !englishText) return;
    window.clearTimeout(retryTimerRef.current);
    autoVoiceRef.current?.stop();
    setSpeechError("");
    setAutoVoiceStatus("speaking");
    const ok = speakAuditionSentence(englishText,
      () => { if (!manualInputRef.current) startAutomaticListening(); },
      () => { setAutoVoiceStatus("idle"); setSpeechError("Не удалось озвучить предложение."); }
    );
    if (!ok) {
      setAutoVoiceStatus("idle");
      setSpeechError("Браузер не поддерживает озвучивание.");
    }
  }

  useEffect(() => {
    if (audioEnabled && englishText) playSentenceAndListen();
    return () => {
      window.clearTimeout(retryTimerRef.current);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      autoVoiceRef.current?.stop();
      autoVoiceRef.current = null;
    };
  }, [sentence?.id, englishText, audioEnabled]);

  function updateWordAnswer(token, nextValue) {
    manualInputRef.current = true;
    window.clearTimeout(retryTimerRef.current);
    autoVoiceRef.current?.stop();
    setAutoVoiceStatus("idle");
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
    manualInputRef.current = false;
    window.clearTimeout(retryTimerRef.current);
    autoVoiceRef.current?.stop();
    setAutoVoiceStatus("idle");
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

      <div className="audition-mask" aria-label="Английское предложение с пропущенными буквами">
        {maskedTokens.map((token) => {
          if (!token.isWord) {
            return <span key={token.id}>{token.value}</span>;
          }

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

      {autoVoiceStatus !== "idle" && (
        <div className="auto-voice-indicator" role="status" aria-live="polite">
          <span className={autoVoiceStatus === "listening" ? "auto-voice-dot is-listening" : "auto-voice-dot"} />
          {autoVoiceStatus === "speaking" ? "Слушай предложение…" : autoVoiceStatus === "listening" ? "Микрофон активен — слушаю…" : "Распознаю речь…"}
        </div>
      )}
      <div className="audition-audio-actions">
        <button className="button button-primary" type="button" onClick={playSentenceAndListen} disabled={result === "correct" || manualInputRef.current}>
          <span aria-hidden="true">🔊</span> Прослушать ещё раз
        </button>
        <button className="button button-secondary" type="button" onClick={handleDontKnow} disabled={dontKnowCountdown !== null}>
          Не знаю
        </button>
      </div>

      {dontKnowCountdown !== null && (
        <div className="audition-countdown" role="status" aria-live="assertive">
          {dontKnowCountdown}
        </div>
      )}
      {speechError && <p className="audition-speech-error" role="status">{speechError}</p>}
      {voiceAnswer && (
        <p className="audition-voice-answer">Распознано: {voiceAnswer}</p>
      )}

      {result === "correct" ? (
        <div className="feedback correct" role="status">
          <CorrectFeedback />
        </div>
      ) : result === "incorrect" ? (
        <div className="audition-feedback audition-feedback-incorrect" role="alert">
          <strong>Не совсем. Проверь все буквы и их порядок.</strong>
          <span>Исправь ошибки прямо в ячейках предложения.</span>
        </div>
      ) : null}
    </section>
  );
}
