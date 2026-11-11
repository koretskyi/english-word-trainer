import { useEffect, useMemo, useRef, useState } from "react";
import WordGap, { createWordGapOpenedPositions } from "../components/LetterGap.jsx";
import CorrectFeedback from "../components/CorrectFeedback.jsx";

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

function speakAuditionSentence(text) {
  if (!text || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
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
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const recognitionRef = useRef(null);
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
    setVoiceAnswer("");
    setResult("");
    setSpeechError("");
    setWordAnswers({});
    setMaskedTokens(createAuditionMask(englishText));
    wordInputRefs.current = [];
  }, [sentence?.id, englishText]);

  // Как и в режиме «Слова»: после правильного ответа автоматически открываем следующую карточку.
  useEffect(() => {
    if (result !== "correct") return undefined;
    const timer = window.setTimeout(() => {
      setCardIndex((current) => (current + 1) % Math.max(1, filteredSentences.length));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [result, filteredSentences.length]);

  useEffect(() => {
    if (audioEnabled && englishText) {
      speakAuditionSentence(englishText);
    }
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [sentence?.id, englishText, audioEnabled]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
  }, []);

  function validateSentence(text) {
    if (!text.trim()) return;
    setVoiceAnswer(text);
    setResult(normalizeSentence(text) === normalizeSentence(englishText) ? "correct" : "incorrect");
    recognitionRef.current?.stop?.();
  }

  function updateWordAnswer(token, nextValue) {
    const nextAnswers = { ...wordAnswers, [token.id]: nextValue };
    setWordAnswers(nextAnswers);
    setVoiceAnswer("");
    setResult("");

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
      recognitionRef.current?.stop?.();
    }
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError("Распознавание речи не поддерживается этим браузером.");
      return;
    }

    recognitionRef.current?.stop?.();
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setListening(true);
      setSpeechError("");
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      validateSentence(transcript);
    };
    recognition.onerror = (event) => {
      setSpeechError(event.error === "not-allowed"
        ? "Разреши доступ к микрофону в браузере."
        : "Не удалось распознать речь. Попробуй ещё раз.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setListening(false);
      setSpeechError("Не удалось запустить микрофон. Попробуй ещё раз.");
    }
  }

  function nextCard() {
    recognitionRef.current?.stop?.();
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
      <h2 className="russian-sentence audition-translation">{sentence.russian}</h2>

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
              disabled={result === "correct"}
              autoFocus={currentWordIndex === 0}
              firstInputRef={thisWordRef}
              nextInputRef={nextWordRef}
              showMistakes={result === "incorrect"}
              openedPositions={openedPositionsByToken[token.id]}
            />
          );
        })}
      </div>

      <div className="audition-audio-actions">
        <button className="button button-primary" type="button" onClick={() => speakAuditionSentence(englishText)}>
          <span aria-hidden="true">🔊</span> Прослушать ещё раз
        </button>
        <button className="button button-secondary" type="button" onClick={startListening} disabled={listening || result === "correct"}>
          <span aria-hidden="true">🎙️</span> {listening ? "Слушаю..." : "Ответить голосом"}
        </button>
      </div>

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
