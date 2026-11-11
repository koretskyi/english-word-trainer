import { useEffect, useMemo, useRef, useState } from "react";
import WordGap from "../components/LetterGap.jsx";

function getSentenceText(sentence) {
  if (!sentence) return "";
  return (sentence.englishTemplate || "")
    .replace("{word}", sentence.word || "")
    .replace(/\\s+([.,!?;:])/g, "$1");
}

// Разбиваем предложение на слова и знаки препинания.
// Маскировку букв выполняет общий WordGap — тот же, что и в режиме «Слова».
function createAuditionMask(text) {
  return (text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?|[^A-Za-z]+/g) || []).map((part, tokenIndex) => ({
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
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState("");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const recognitionRef = useRef(null);
  const sentence = filteredSentences.length
    ? filteredSentences[cardIndex % filteredSentences.length]
    : null;
  const englishText = getSentenceText(sentence);
  const [maskedTokens, setMaskedTokens] = useState(() => createAuditionMask(englishText));

  useEffect(() => {
    setCardIndex(0);
  }, [selectedLevel]);

  useEffect(() => {
    setAnswer("");
    setResult("");
    setSpeechError("");
    setMaskedTokens(createAuditionMask(englishText));
  }, [sentence?.id, englishText]);

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

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError("Распознавание речи не поддерживается этим браузером. Можно ввести предложение вручную.");
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
      setAnswer(transcript);
      setResult("");
    };
    recognition.onerror = (event) => {
      setSpeechError(event.error === "not-allowed"
        ? "Разреши доступ к микрофону в браузере."
        : "Не удалось распознать речь. Попробуй ещё раз или введи предложение.");
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

  function checkAnswer(event) {
    event?.preventDefault?.();
    if (!sentence || !answer.trim()) return;
    if (normalizeSentence(answer) === normalizeSentence(englishText)) {
      setResult("correct");
      recognitionRef.current?.stop?.();
    } else {
      setResult("incorrect");
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

  return (
    <section className="panel audition-panel">
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
        {maskedTokens.map((token) => (
          token.isWord ? (
            <WordGap
              key={token.id}
              sentence={{ id: token.id, word: token.value }}
              value={[]}
              onChange={() => {}}
              disabled
            />
          ) : (
            <span key={token.id}>{token.value}</span>
          )
        ))}
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

      <form className="audition-answer-form" onSubmit={checkAnswer}>
        <label htmlFor="audition-answer">Произнеси или напечатай всё предложение целиком:</label>
        <textarea
          id="audition-answer"
          rows={3}
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
            if (result) setResult("");
          }}
          placeholder="Type the complete English sentence..."
          disabled={result === "correct"}
          autoComplete="off"
          spellCheck={false}
        />
        {result === "correct" ? (
          <div className="audition-feedback audition-feedback-correct" role="status">
            <strong>✓ Правильно! Всё предложение без ошибок.</strong>
            <button className="button button-primary" type="button" onClick={nextCard}>Следующее предложение</button>
          </div>
        ) : (
          <>
            {result === "incorrect" && (
              <div className="audition-feedback audition-feedback-incorrect" role="alert">
                <strong>Не совсем. Проверь все слова и их порядок.</strong>
                <span>Попробуй ещё раз — карточка засчитывается только при полном совпадении.</span>
              </div>
            )}
            <button className="button button-primary audition-check-button" type="submit" disabled={!answer.trim()}>
              Проверить предложение
            </button>
          </>
        )}
      </form>
    </section>
  );
}
