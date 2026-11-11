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
  const [dontKnowCountdown, setDontKnowCountdown] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [transcribing, setTranscribing] = useState(false);
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
    setDontKnowCountdown(null);
    setWordAnswers({});
    setMaskedTokens(createAuditionMask(englishText));
    wordInputRefs.current = [];
  }, [sentence?.id, englishText]);

  // При «Не знаю» показываем полный ответ и отсчитываем три секунды.
  useEffect(() => {
    if (dontKnowCountdown === null) return undefined;
    if (dontKnowCountdown === 0) {
      nextCard();
      setDontKnowCountdown(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDontKnowCountdown((current) => current === null ? null : current - 1);
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

  useEffect(() => {
    if (audioEnabled && englishText) {
      speakAuditionSentence(englishText);
    }
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [sentence?.id, englishText, audioEnabled]);

  useEffect(() => () => {
    mediaRecorderRef.current?.stream?.getTracks?.().forEach((track) => track.stop());
    mediaRecorderRef.current?.stop?.();
  }, []);

  function validateSentence(text) {
    if (!text.trim()) return;
    setVoiceAnswer(text);
    setResult(normalizeSentence(text) === normalizeSentence(englishText) ? "correct" : "incorrect");
    mediaRecorderRef.current?.stop?.();
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
      mediaRecorderRef.current?.stop?.();
    }
  }

  async function startListening() {
    if (listening) {
      mediaRecorderRef.current?.stop?.();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSpeechError("Запись аудио не поддерживается этим браузером. Попробуй Chrome или Edge.");
      return;
    }
    try {
      setSpeechError("");
      setVoiceAnswer("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        setSpeechError("Не удалось записать звук. Попробуй ещё раз.");
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        if (!blob.size) {
          setSpeechError("Запись пустая. Попробуй ещё раз.");
          return;
        }
        setTranscribing(true);
        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Ошибка распознавания речи.");
          if (!data.text?.trim()) throw new Error("Не удалось разобрать речь. Попробуй ещё раз.");
          validateSentence(data.text);
        } catch (error) {
          setSpeechError(error.message || "Ошибка отправки аудио на распознавание.");
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      setListening(true);
    } catch (error) {
      setListening(false);
      setSpeechError(error.name === "NotAllowedError"
        ? "Разреши доступ к микрофону в браузере."
        : "Не удалось включить микрофон. Проверь подключение.");
    }
  }

  function handleDontKnow() {
    if (listening) mediaRecorderRef.current?.stop?.();
    setListening(false);
    setVoiceAnswer("");
    setResult("");
    setSpeechError("");
    setDontKnowCountdown(3);
  }

  function nextCard() {
    mediaRecorderRef.current?.stop?.();
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

      <div className="audition-audio-actions">
        <button className="button button-primary" type="button" onClick={() => speakAuditionSentence(englishText)}>
          <span aria-hidden="true">🔊</span> Прослушать ещё раз
        </button>
        <button className="button button-secondary" type="button" onClick={startListening} disabled={transcribing || result === "correct"}>
          <span aria-hidden="true">🎙️</span> {transcribing ? "Распознаю..." : listening ? "Остановить и распознать" : "Ответить голосом"}
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
