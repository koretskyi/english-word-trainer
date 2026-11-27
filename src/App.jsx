import { SENTENCES } from "./sentences.js";
import WordGap from "./components/LetterGap.jsx";
import CorrectFeedback from "./components/CorrectFeedback.jsx";
import AuditionPage from "./pages/AuditionPage.jsx";
import VideoPage from "./pages/VideoPage.jsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { startAutoVoiceCapture } from "./utils/autoVoice.js";




const STORAGE_KEY = "english-word-trainer-v1";



function loadSentences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved !== null) {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed)) {
        // Ignore corrupted or incomplete localStorage entries.
        const validParsed = parsed.filter(
          (sentence) =>
            sentence &&
            typeof sentence === "object" &&
            sentence.id != null &&
            typeof sentence.word === "string" &&
            typeof sentence.level === "string"
        );
        const savedById = new Map();

        for (const sentence of validParsed) {
          if (sentence && sentence.id != null) {
            savedById.set(sentence.id, sentence);
          }
        }

        const builtInIds = new Set(SENTENCES.map((sentence) => sentence.id));

        // Keep built-in order; user edits of the same id win.
        // New built-in ids still appear even if they were never saved.
        const mergedBuiltIn = SENTENCES.map((sentence) => {
          const savedSentence = savedById.get(sentence.id);
          return savedSentence
            ? {
                ...sentence,
                ...savedSentence,
                pixabayQuery: savedSentence.pixabayQueryVersion === 2
                  ? savedSentence.pixabayQuery
                  : sentence.pixabayQuery,
                pixabayQueryVersion: 2,
                russianWord: savedSentence.russianWord || sentence.russianWord,
              }
            : sentence;
        });

        const userCreated = validParsed.filter(
          (sentence) => !builtInIds.has(sentence.id)
        );

        return [...mergedBuiltIn, ...userCreated];
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки предложений:", error);
  }

  return SENTENCES;
}



const LEARNING_STORAGE_KEY = "english-word-trainer-learning-v1";
const REVIEW_INTERVALS = [5, 10, 20, 40, 80, 160];
const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
}

function renderRussianSentence(sentence, targetWord) {
  sentence = String(sentence || "").replace(/\.+\s*$/, "");
  const normalize = (value) => String(value || "").toLocaleLowerCase("ru").replace(/[^а-яё]/gi, "");
  const target = normalize(targetWord);
  if (!target) return sentence;

  return String(sentence || "").split(/(\p{L}+)/u).map((part, index) => {
    if (!/\p{L}/u.test(part)) return part;
    const token = normalize(part);
    let commonLength = 0;
    while (commonLength < token.length && commonLength < target.length &&
      token[commonLength] === target[commonLength]) commonLength++;
    const matches = token.length > 0 && commonLength >= Math.min(5, target.length);
    return matches
      ? <span className="target-translation" key={index}>{part}</span>
      : part;
  });
}

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadLearningData() {
  const emptyStats = {
    totalAnswers: 0,
    correctAnswers: 0,
    streak: 0,
    daily: { date: getLocalDateKey(), count: 0 },
  };
  try {
    const saved = localStorage.getItem(LEARNING_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.version === 1 && parsed.words) {
        return {
          version: 1,
          completedCount: Number(parsed.completedCount) || 0,
          words: parsed.words,
          stats: {
            ...emptyStats,
            ...(parsed.stats || {}),
            daily: parsed.stats?.daily || emptyStats.daily,
          },
        };
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки прогресса:", error);
  }
  return { version: 1, completedCount: 0, words: {}, stats: emptyStats };
}

function selectNextSentence(sentences, learningData) {
  const unique = new Map();
  sentences.forEach((sentence) => {
    const key = normalizeWord(sentence.word);
    if (key && !unique.has(key)) unique.set(key, sentence);
  });

  const entries = Array.from(unique.entries());
  const due = entries
    .filter(([key]) => {
      const state = learningData.words[key];
      return state && state.status === "REVIEW" &&
        state.dueAt <= learningData.completedCount;
    })
    .sort((a, b) => {
      const left = learningData.words[a[0]];
      const right = learningData.words[b[0]];
      return (left.dueAt - right.dueAt) || ((left.order || 0) - (right.order || 0));
    });

  if (due.length) return due[0][1];

  const fresh = entries.find(([key]) => {
    const state = learningData.words[key];
    return !state || state.status === "NEW";
  });
  return fresh ? fresh[1] : null;
}

function recordWordAnswer(previous, word, isCorrect) {
  const key = normalizeWord(word);
  const completedCount = previous.completedCount + 1;
  const old = previous.words[key] || { status: "NEW", stage: 0 };
  const words = { ...previous.words };

  if (!isCorrect) {
    words[key] = {
      status: "REVIEW",
      stage: 1,
      dueAt: completedCount + REVIEW_INTERVALS[0],
      order: completedCount,
    };
  } else if (old.status === "NEW") {
    words[key] = { status: "MASTERED", stage: 6, masteredAt: completedCount };
  } else if (old.status === "REVIEW") {
    if (old.stage >= REVIEW_INTERVALS.length) {
      words[key] = { status: "MASTERED", stage: 6, masteredAt: completedCount };
    } else {
      const nextStage = old.stage + 1;
      words[key] = {
        status: "REVIEW",
        stage: nextStage,
        dueAt: completedCount + REVIEW_INTERVALS[nextStage - 1],
        order: completedCount,
      };
    }
  }

  const previousStats = previous.stats || {
    totalAnswers: 0,
    correctAnswers: 0,
    streak: 0,
    daily: { date: getLocalDateKey(), count: 0 },
  };
  const today = getLocalDateKey();
  const dailyCount = previousStats.daily?.date === today
    ? (Number(previousStats.daily.count) || 0) + 1
    : 1;
  const stats = {
    totalAnswers: (Number(previousStats.totalAnswers) || 0) + 1,
    correctAnswers: (Number(previousStats.correctAnswers) || 0) + (isCorrect ? 1 : 0),
    streak: isCorrect ? (Number(previousStats.streak) || 0) + 1 : 0,
    daily: { date: today, count: dailyCount },
  };

  return { version: 1, completedCount, words, stats };
}

const VIDEO_LIBRARY_KEY = "english-word-trainer-video-library-v1";
const VIDEO_PROGRESS_KEY = "english-word-trainer-video-progress-v1";

function loadCompletedVideoIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIDEO_PROGRESS_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function loadVideos() {
  try {
    const saved = localStorage.getItem(VIDEO_LIBRARY_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.url) : [];
  } catch {
    return [];
  }
}

function getYouTubeVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
    const parts = parsed.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
    return marker >= 0 ? parts[marker + 1] || "" : "";
  } catch {
    return "";
  }
}

function VideoTimeFields({ label, value, onSave, allowEmpty = false }) {
  const initial = String(value || "").split(":");
  const [minutes, setMinutes] = useState(initial.length > 1 ? initial[initial.length - 2] : (initial[0] || ""));
  const [seconds, setSeconds] = useState(initial.length > 1 ? initial[initial.length - 1] : "00");

  useEffect(() => {
    const parts = String(value || "").split(":");
    setMinutes(value ? (parts.length > 1 ? parts[parts.length - 2] : parts[0]) : "");
    setSeconds(value ? (parts.length > 1 ? parts[parts.length - 1] : "00") : "");
  }, [value]);

  function saveParts(nextMinutes, nextSeconds) {
    if (allowEmpty && !nextMinutes.trim() && !nextSeconds.trim()) {
      onSave("");
      return;
    }
    const mins = Math.max(0, Number.parseInt(nextMinutes || "0", 10) || 0);
    const secs = Math.min(59, Math.max(0, Number.parseInt(nextSeconds || "0", 10) || 0));
    onSave(`${mins}:${String(secs).padStart(2, "0")}`);
  }

  return (
    <div className="admin-video-time-field">
      <span>{label}</span>
      <div className="admin-video-time-inputs">
        <label><input type="number" min="0" step="1" value={minutes}
          onChange={(event) => {
            const next = event.target.value;
            setMinutes(next);
            saveParts(next, seconds);
          }} placeholder="0" aria-label={`${label}: минуты`} /> <small>мин</small></label>
        <label><input type="number" min="0" max="59" step="1" value={seconds}
          onChange={(event) => {
            const next = event.target.value;
            setSeconds(next);
            saveParts(minutes, next);
          }} placeholder="0" aria-label={`${label}: секунды`} /> <small>сек</small></label>
      </div>
    </div>
  );
}

function createId() {

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;

}



// Открытые буквы сразу помещаются на свои места.


function createInitialAnswer(sentence) {
  if (!sentence) return [];

  const letters = [...sentence.word];

  // Все поля изначально пустые, включая открытые буквы.
  // Открытые буквы остаются подсказками, но пользователь вводит их сам.
  return letters.map(() => "");
}




// Каждая буква слова находится в отдельном поле ввода.





// Озвучивание английского предложения встроенным синтезом речи браузера.
function speakEnglish(text, onFinished) {
  if (!text || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (onFinished) {
    utterance.onend = onFinished;
    utterance.onerror = onFinished;
  }
  const voices = window.speechSynthesis.getVoices();
  const englishVoices = voices.filter((voice) => /^en(-|_)/i.test(voice.lang));
  // Сначала выбираем именно Microsoft Jenny; остальные голоса — только запасной вариант.
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

const REVIEW_STAGE_ICONS = ["🌱", "🌿", "🌳", "⭐", "🏆", "👑"];

function ReviewLadder({ stage = 1, compact = false }) {
  // Stage 6 is the final interval still waiting for a successful answer.
  // Keep the last icon empty until that final review is passed.
  const currentStage = Math.min(5, Math.max(1, Number(stage) || 1));
  return (
    <div
      className={compact ? "review-ladder review-ladder-compact" : "review-ladder"}
      role="progressbar"
      aria-label={`Путь освоения слова: этап ${currentStage} из 6`}
      aria-valuemin={1}
      aria-valuemax={6}
      aria-valuenow={currentStage}
    >
      <div className="review-ladder-steps">
        {REVIEW_STAGE_ICONS.map((icon, index) => (
          <span
            key={icon}
            className={index < currentStage ? "review-ladder-step reached" : "review-ladder-step"}
            aria-hidden="true"
            title={`Этап ${index + 1}`}
          >
            {icon}
          </span>
        ))}
      </div>
    </div>
  );
}

// Загружает локальную иллюстрацию, а при её отсутствии ищет подходящую в Openverse.
// Загружает локальное изображение A2 или один раз получает его с Pixabay и сохраняет на диск.
const WordImage = ({ sentence }) => {
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

    async function loadWordImage() {
      const key = String(word).toLowerCase().trim();
      try {
        // Backend validates the versioned local cache and searches using the prepared English subject + predicate phrase.
        const response = await fetch("/api/word-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: key, context: sentence?.pixabayQuery || String(sentence?.englishTemplate || "").replace("{word}", word) }),
          signal: controller.signal,
        });
        const responseType = response.headers.get("content-type") || "";
        const responseBody = await response.text();
        let responseData = {};
        if (responseType.includes("application/json")) {
          try {
            responseData = JSON.parse(responseBody);
          } catch {
            throw new Error("Сервер изображений вернул повреждённый JSON.");
          }
        } else {
          const preview = responseBody.slice(0, 120).replace(/\s+/g, " ");
          throw new Error(
            `Вместо JSON получен HTML/текст (HTTP ${response.status}). Проверь, что запущен актуальный backend на 127.0.0.1:8001 и открыт Vite на 5173. Ответ: ${preview}`
          );
        }
        if (!response.ok) {
          throw new Error(responseData.detail || `Image API HTTP ${response.status}`);
        }
        const savedImage = responseData;
        setImage(savedImage);
        setStatus("ready");
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Не удалось сохранить иллюстрацию слова:", error);
          setImage(null);
          setStatus("error");
        }
      }
    }

    loadWordImage();
    return () => controller.abort();
  }, [word, sentence?.pixabayQuery, sentence?.englishTemplate]);

  if (status === "loading") {
    return <div className="word-image-placeholder" aria-live="polite">Подбираю изображение…</div>;
  }
  if (status !== "ready" || !image) {
    return <div className="word-image-placeholder is-empty">Иллюстрация пока не найдена</div>;
  }

  return (
    <figure className="word-image-card">
      <img src={image.src} alt={`Иллюстрация: ${word}`} loading="lazy"
        onError={() => { setImage(null); setStatus("error"); }} />
    </figure>
  );
};

// Визуальная замена фотографии на экранах результата.
function StudyFeedbackVisual({ correct, markedKnown }) {
  const visual = markedKnown
    ? { icon: "🧑‍🎓", title: "Уже выучено", tone: "known" }
    : correct
      ? { icon: "🏆", title: "Отличная работа!", tone: "correct" }
      : { icon: "📖", title: "На повторение", tone: "review" };

  return (
    <div className={`study-feedback-visual is-${visual.tone}`} role="img" aria-label={visual.title}>
      <span className="study-feedback-visual-icon" aria-hidden="true">{visual.icon}</span>
      <span className="study-feedback-visual-title">{visual.title}</span>
    </div>
  );
}
// Страница обучения с интервальным повторением.
function StudyPage({
  sentence,
  audioEnabled,
  selectedLevel,
  setSelectedLevel,
  levels,
  levelWordCount,
  onComplete,
  onAdvance,
  masteredCount,
  totalWords,
  completedCount,
  reviewWords,
  stats,
  levelProgress,
  showStats,
  setShowStats,
  statsLevel,
  setStatsLevel,
  isReview,
  reviewStage,
  onKnow,
}) {
  const [answer, setAnswer] = useState(() => createInitialAnswer(sentence));
  const [checked, setChecked] = useState(false);
  const [audioFinished, setAudioFinished] = useState(false);
  const [markedKnown, setMarkedKnown] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceRecognizedText, setVoiceRecognizedText] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [voiceSuccessConfetti, setVoiceSuccessConfetti] = useState(false);
  const voiceCaptureRef = useRef(null);
  const voiceActiveRef = useRef(false);
  const micStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserFrameRef = useRef(null);
  const targetLetters = sentence ? [...sentence.word] : [];

  function stopMicrophoneMeter() {
    if (analyserFrameRef.current) cancelAnimationFrame(analyserFrameRef.current);
    analyserFrameRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    setMicLevel(0);
  }

  useEffect(() => () => {
    voiceCaptureRef.current?.stop();
    setVoiceListening(false);
  }, [sentence?.id]);

  // Keep StudyPage mounted between levels. Reset card-local state before the
  // browser paints the newly selected sentence to avoid a one-frame flash.
  useLayoutEffect(() => {
    voiceCaptureRef.current?.stop();
    voiceCaptureRef.current = null;
    stopMicrophoneMeter();
    setAnswer(createInitialAnswer(sentence));
    setChecked(false);
    setAudioFinished(false);
    setMarkedKnown(false);
    setVoiceListening(false);
    setVoiceStatus("idle");
    setVoiceModeActive(false);
    setVoiceError("");
    setVoiceRecognizedText("");
    setVoiceSuccessConfetti(false);
  }, [selectedLevel, sentence?.id]);

  function startVoiceInput() {
    voiceCaptureRef.current?.stop();
    setVoiceError("");
    setVoiceRecognizedText("");
    setVoiceModeActive(true);
    setVoiceListening(true);
    const capture = startAutoVoiceCapture({
      expectedWord: sentence.word,
      // TEST MODE: use the smaller model on vocabulary cards; VideoPage stays on Medium.
      whisperModel: "small",
      // Short, responsive capture for a single vocabulary word.
      silenceMs: 800,
      maxRecordingMs: 3000,
      speechConfirmMs: 0,
      calibrationMs: 0,
      noSpeechTimeoutMs: 2000,
      onStatus: (status) => {
        setVoiceStatus(status);
        if (status === "transcribing") setVoiceSuccessConfetti(true);
        const active = status === "listening" || status === "transcribing";
        setVoiceListening(active);
        if (!active) setMicLevel(0);
      },
      onLevel: (level) => setMicLevel(level),
      onText: (recognizedText, recognitionData) => {
        const transcript = String(recognizedText || "").trim();
        if (recognitionData?.is_correct === true) {
          setVoiceError("");
          handleAnswerChange(targetLetters.map((letter) => letter));
          window.setTimeout(() => {
            setVoiceSuccessConfetti(false);
            setVoiceModeActive(false);
          }, 1300);
          return;
        }
        // Keep the answer mask empty after an incorrect recognition.
        setAnswer(targetLetters.map(() => ""));
        setVoiceRecognizedText(transcript);
        setVoiceError(transcript ? "Попробуйте ещё раз." : "Не удалось разобрать речь. Попробуйте ещё раз.");
      },
      onError: (message) => {
        setVoiceRecognizedText("");
        setVoiceError(message || "Ошибка локального распознавания Whisper.");
      },
      onNoSpeech: () => {
        // Keep the expanded voice card open when no speech was detected.
        // The user can retry or choose "Не знаю" explicitly.
        setVoiceRecognizedText("");
        setVoiceError("Не расслышал. Повторите, пожалуйста.");
      },
    });
    voiceCaptureRef.current = capture;
    capture.start();
  }

  const correct = Boolean(sentence) && targetLetters.length > 0 &&
    targetLetters.every((letter, position) =>
      (answer[position] || "").toLowerCase() === letter.toLowerCase()
    );

  useEffect(() => {
    if (!checked || (correct && !audioFinished)) return undefined;
    const timer = setTimeout(onAdvance, correct ? 1400 : 4000);
    return () => clearTimeout(timer);
  }, [checked, correct, audioFinished, onAdvance]);

  const englishText = sentence
    ? sentence.englishTemplate.replace("{word}", sentence.word)
    : "";

  const displayTemplate = sentence
    ? sentence.englishTemplate.replace(/\.+\s*$/, "")
    : "";
  const parts = sentence ? displayTemplate.split("{word}") : [];
  const selectedLevelReviewCount = reviewWords.filter(
    (item) => item.level === selectedLevel
  ).length;
  const selectedLevelProgressPercent = totalWords
    ? Math.round((masteredCount / totalWords) * 100)
    : 0;
  const levelSelector = (
    <div className="review-progress-meta">
      <div className="level-selector">
        <div className="level-label-group">
          <label htmlFor="study-level">уровень:</label>
          <span className="level-word-count">({levelWordCount} слов)</span>
        </div>
        <select id="study-level" value={selectedLevel}
          onChange={(event) => setSelectedLevel(event.target.value)}>
          {levels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
        <div className="learning-progress-card learning-progress-card-compact" aria-label={`Прогресс уровня: ${selectedLevelProgressPercent}%`}>
          <div className="learning-progress-heading">
            <span>Прогресс</span>
            <strong>{selectedLevelProgressPercent}%</strong>
          </div>
          <div className="learning-progress-track">
            <div className="learning-progress-fill" style={{ width: `${selectedLevelProgressPercent}%` }} />
          </div>
        </div>
        <button type="button" className={`level-review-shortcut${isReview ? " is-review-active" : ""}`}
          onClick={() => { setStatsLevel(selectedLevel); setShowStats(true); }}
          aria-label={`Открыть статистику: ${selectedLevelReviewCount} слов на повторении уровня ${selectedLevel}`}
          title={`Слова на повторении уровня ${selectedLevel}`}>
          <strong>{selectedLevelReviewCount}</strong>
          <span>на повторении</span>
        </button>
      </div>
    </div>
  );

  const statsLevelWords = reviewWords.filter((item) => item.level === statsLevel);

  const accuracy = stats.totalAnswers
    ? Math.round((stats.correctAnswers / stats.totalAnswers) * 100)
    : 0;

  const statsPanel = showStats ? (
    <div className="panel review-words-panel stats-panel">
      <h3>Статистика обучения</h3>
      <div className="stats-grid">
        <div className="stat-card">
          <span>Слов изучено сегодня</span>
          <strong>{stats.daily?.date === getLocalDateKey() ? stats.daily.count : 0}</strong>
        </div>
        <div className="stat-card">
          <span>Правильных подряд</span>
          <strong>{stats.streak}</strong>
        </div>
        <div className="stat-card">
          <span>Точность ответов</span>
          <strong>{accuracy}%</strong>
          <small>{stats.correctAnswers} из {stats.totalAnswers}</small>
        </div>
        <div className="stat-card">
          <span>Слов на повторении</span>
          <strong>{reviewWords.length}</strong>
        </div>
      </div>

      <h4>Прогресс по уровням</h4>
      <div className="level-progress-list">
        {levelProgress.map((item) => (
          <div className="level-progress-item" key={item.level}>
            <div className="level-progress-heading">
              <strong>{item.level}</strong>
              <span>{item.mastered} / {item.total} ({item.percent}%)</span>
            </div>
            <div className="level-progress-track">
              <div className="level-progress-fill" style={{ width: `${item.percent}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="stats-review-title-row">
        <h4>Слова на повторении — {statsLevel}</h4>
        <span className="stats-review-total">{statsLevelWords.length} слов</span>
      </div>
      <div className="stats-level-tabs" role="tablist" aria-label="Уровень слов на повторении">
        {levels.map((level) => {
          const count = reviewWords.filter((item) => item.level === level).length;
          return (
            <button
              key={level}
              type="button"
              role="tab"
              aria-selected={statsLevel === level}
              className={statsLevel === level ? "stats-level-tab active" : "stats-level-tab"}
              onClick={() => setStatsLevel(level)}
            >
              {level} <span>{count}</span>
            </button>
          );
        })}
      </div>
      {statsLevelWords.length === 0 ? (
        <p>На уровне {statsLevel} пока нет слов на повторении.</p>
      ) : (
        <section className="stats-review-level" key={statsLevel}>
          <ol className="stats-review-list">
            {statsLevelWords.map((item, index) => (
              <li key={item.key} className="review-word-item">
                <div className="review-word-heading">
                  <span className="review-word-number">{index + 1}</span>
                  <strong className="review-word-name">{item.word}</strong>
                  <span className="review-word-level">{item.level}</span>
                </div>
                <ReviewLadder stage={item.stage} compact />
                <span className="review-word-due">
                  До появления: <strong>{Math.max(1, item.remaining)}</strong>{" "}
                  {Math.max(1, item.remaining) === 1
                    ? "карточка"
                    : Math.max(1, item.remaining) >= 2 && Math.max(1, item.remaining) <= 4
                      ? "карточки"
                      : "карточек"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  ) : null;

  // В режиме статистики не показываем карточку обучения.
  if (showStats) {
    return (
      <section className="stats-only-view">
        {statsPanel}
      </section>
    );
  }

  function handleAnswerChange(nextAnswer) {
    if (checked) return;
    setAnswer(nextAnswer);
    const complete = targetLetters.every((_, position) => Boolean(nextAnswer[position]));
    if (complete) {
      const isRight = targetLetters.every((letter, position) =>
        (nextAnswer[position] || "").toLowerCase() === letter.toLowerCase()
      );
      setChecked(true);
      onComplete(sentence.word, isRight);
      if (isRight) {
        // Экран результата показывается сразу; озвучка завершится отдельно.
        if (audioEnabled) {
          const started = speakEnglish(englishText, () => setAudioFinished(true));
          if (!started) setAudioFinished(true);
        } else {
          setAudioFinished(true);
        }
      } else if (audioEnabled) {
        // При ошибке произносим правильное английское слово.
        speakEnglish(sentence.word);
      }
    }
  }

  function dontKnow() {
    if (!sentence || checked) return;
    voiceCaptureRef.current?.stop();
    setVoiceListening(false);
    setVoiceModeActive(false);
    setVoiceStatus("idle");
    setChecked(true);
    onComplete(sentence.word, false);
    if (audioEnabled) speakEnglish(sentence.word);
  }

  function knowWord() {
    if (!sentence || checked) return;
    setMarkedKnown(true);
    setChecked(true);
    onKnow();
  }

  if (!sentence) {
    return (
      <section className="panel">
        {levelSelector}
        {statsPanel}
        <h2>На уровне {selectedLevel} пока нет доступных карточек</h2>
        <p>Новые слова закончились, а слова на повторение ещё не подошли по интервалу.</p>
        <p>Выполнено ответов: {completedCount}. Переключи уровень или добавь слова через админку.</p>
      </section>
    );
  }

  const resultState = markedKnown ? "is-known" : correct ? "is-correct" : "is-incorrect";

  return (
    <section className={`panel study-panel${voiceModeActive ? " is-voice-listening" : ""}`}>
      {voiceModeActive && (
        <div className="word-listening-mode">
          <button className={"word-listening-mic-button" + (voiceStatus === "listening" ? " is-listening" : "")} type="button"
            onClick={startVoiceInput} disabled={voiceListening}
            aria-label={voiceListening ? "Микрофон слушает" : "Повторить голосовой ответ"}>
            <span className="word-mic-visualizer" aria-hidden="true"
              style={{ "--mic-level": micLevel, "--mic-scale": 1 + micLevel * 0.34 }}>
              <span className="word-mic-glow" />
              <svg viewBox="0 0 120 120">
                <path d="M60 70a15 15 0 0 0 15-15V30a15 15 0 0 0-30 0v25a15 15 0 0 0 15 15Z" />
                <path d="M90 55a30 30 0 0 1-60 0M60 85v18m-18 0h36" />
              </svg>
            </span>
            {voiceSuccessConfetti && (
              <span className="mic-success-confetti confetti" aria-hidden="true">
                {Array.from({ length: 42 }, (_, index) => (
                  <span
                    key={index}
                    style={{
                      left: `${(index * 37) % 100}%`,
                      animationDelay: `${(index % 12) * 0.035}s`,
                      "--fall-duration": `${1.05 + (index % 6) * 0.1}s`,
                    }}
                  />
                ))}
              </span>
            )}
          </button>
          <p className="word-listening-target">{sentence.russianWord || "Переведите слово"}</p>
          {voiceStatus === "listening" && <p className="word-listening-status" role="status">Слушаю… Произнесите слово.</p>}
          {voiceStatus === "transcribing" && (
            <div className="word-listening-recognition" role="status" aria-live="polite">
              <div className="word-listening-received">
                <span className="word-listening-check" aria-hidden="true">✓</span>
                <strong>Текст распознан</strong>
              </div>
              <p className="word-listening-processing">Распознавание…</p>
            </div>
          )}
          <div className="word-listening-english">
            <WordGap key={"voice-" + sentence.id + "-" + sentence.word} sentence={sentence}
              value={answer} onChange={handleAnswerChange} disabled={checked}
              showMistakes={false} autoFocus={false} />
          </div>
          {voiceError && (
            <div className="word-listening-error" role="alert">
              {voiceRecognizedText && (
                <>
                  <span className="word-listening-error-label">Распознано:</span>
                  <strong className="word-listening-recognized-word">{voiceRecognizedText}</strong>
                </>
              )}
              <span>{voiceError}</span>
            </div>
          )}
          {!voiceListening && (
            <button className="button button-secondary word-listening-retry"
              type="button" onClick={startVoiceInput}>Попробовать ещё раз</button>
          )}
          {!checked && (
            <button className="button button-secondary word-listening-dont-know"
              type="button" onClick={dontKnow}>Не знаю</button>
          )}
        </div>
      )}
      <div className="level-switch-content">
        {levelSelector}
        {statsPanel}
      <div className={`study-card-shell${checked ? " is-answered" : ""}${checked && (correct || markedKnown) ? " is-success" : ""}`}>
        {(isReview || checked) && (
          <div className="study-card-review-progress"
            role="progressbar"
            aria-label={`Прогресс изучения слова: этап ${Math.min(6, Math.max(1, reviewStage))} из 6`}
            aria-valuemin={1} aria-valuemax={6}
            aria-valuenow={Math.min(6, Math.max(1, reviewStage))}>
{checked && !correct && !markedKnown && isReview ? (
              <div className="study-card-review-reset" role="status">ПРОГРЕСС СБРОШЕН</div>
            ) : (
              <>
                <div className="study-card-review-progress-heading">
                  <span>ПРОГРЕСС ПОВТОРЕНИЯ</span>
                  <strong>{Math.min(6, Math.max(1, reviewStage))}/6</strong>
                </div>
                <div className="study-card-review-progress-track">
                  {Array.from({ length: 6 }, (_, index) => (
                    <span key={index} className={index < Math.min(6, Math.max(1, reviewStage)) ? "is-filled" : ""} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className={`study-card-image-slot${checked && !correct && !markedKnown ? " is-feedback" : ""}`}>
          {checked && !correct && !markedKnown
            ? <StudyFeedbackVisual correct={correct} markedKnown={markedKnown} />
            : <WordImage sentence={sentence} />}
        </div>
        <h2 className="russian-sentence">{renderRussianSentence(sentence.russian, sentence.russianWord)}</h2>
        <div className={`study-card-english${checked ? " is-result" : ""}`}>
          {checked ? (
            <p className="study-result-english">
              {parts[0]}<strong>{sentence.word}</strong>{parts.slice(1).join("{word}")}
            </p>
          ) : (
            <div className="english-section">
              <div className="answer-area">
                <div className="english-sentence">
                  <span>{parts[0]}</span>
                  <WordGap key={`${sentence.id}-${sentence.word}`} sentence={sentence} value={answer}
                    onChange={handleAnswerChange} disabled={false} autoFocus
                    showMistakes={false} />
                  <span>{parts.slice(1).join("{word}")}</span>
                </div>
                <p className="study-instruction">ВПИШИТЕ СЛОВО <strong className="target-translation">{sentence.russianWord || "—"}</strong> НА АНГЛИЙСКОМ:</p>
              </div>
            </div>
          )}
        </div>
        {checked ? (
          <div className={`answer-result-card ${resultState}`} role="status" aria-live="polite">
            {markedKnown ? (
              <strong className="known-result-message">✓ Слово перенесено в выученные</strong>
            ) : correct ? (
              <CorrectFeedback />
            ) : (
              <div className="incorrect-result-content">
                <div className="incorrect-word-pair">
                  <div className="answer-value-label is-correct-label">Правильный ответ</div>
                  <div className="answer-value-label is-wrong-label">Ваш ответ</div>
                  <strong className="answer-value is-correct-answer">{sentence.word}</strong>
                  <strong className="answer-value is-wrong-answer">{answer.join("").trim() || "—"}</strong>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="study-card-footer">
            <div className="form-actions word-answer-actions">
              <button className={`button button-secondary word-microphone-button${voiceListening ? " is-listening" : ""}`}
                type="button" onClick={startVoiceInput} disabled={voiceListening}
                aria-label="Ввести слово голосом">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4m-4 0h8"/></svg>
                {voiceListening ? "Слушаю…" : "Ответить голосом"}
              </button>
              <button className="button button-secondary button-dont-know" type="button"
                onClick={dontKnow}>Не знаю</button>
              <button className="button button-primary" type="button"
                onClick={knowWord}>Я знаю</button>
            </div>
            {voiceError && <p className="word-voice-error" role="alert">{voiceError}</p>}
          </div>
        )}
      </div>
      </div>
    </section>
  );
}



// Начальные значения формы админки.

const EMPTY_FORM = {
  russian: "",
  russianWord: "",
  englishTemplate: "",
  word: "",
  pixabayQuery: "",
  pixabayQueryVersion: 2,
  level: "A1",
};



// Локальная админка.

function AdminPage({ sentences, onSave, onDelete, videos, onSaveVideo, onDeleteVideo }) {
  const safeSentences = Array.isArray(sentences)
    ? sentences.filter((sentence) => sentence && typeof sentence === "object")
    : [];


  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [editingId, setEditingId] = useState(null);

  const [error, setError] = useState("");
  const [activeLevel, setActiveLevel] = useState("A1");
  const adminLevels = ["A1", "A2", "B1", "B2", "C1"];
  const [subtitleJobs, setSubtitleJobs] = useState({});
  const [subtitleErrors, setSubtitleErrors] = useState({});

  async function fetchVideoSubtitles(video) {
    setSubtitleErrors((current) => ({ ...current, [video.id]: "" }));
    setSubtitleJobs((current) => ({ ...current, [video.id]: "loading" }));
    try {
      const response = await fetch("/api/youtube-subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: video.url, startTime: video.startTime || "00:00", endTime: video.endTime || "" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Не удалось получить субтитры.");
      const transcript = String(data.text || "").trim();
      if (!transcript) throw new Error("YouTube не вернул английские субтитры.");
      onSaveVideo({ ...video, transcript, subtitleCues: Array.isArray(data.cues) ? data.cues : [] });
      setSubtitleJobs((current) => ({ ...current, [video.id]: "done" }));
    } catch (error) {
      setSubtitleErrors((current) => ({ ...current, [video.id]: error.message || "Ошибка загрузки субтитров." }));
      setSubtitleJobs((current) => ({ ...current, [video.id]: "error" }));
    }
  }



  function update(field, value) {

    setForm((current) => ({

      ...current,

      [field]: value,

    }));

  }



  function resetForm() {

    setForm({ ...EMPTY_FORM });

    setEditingId(null);

    setError("");

  }



  function editSentence(sentence) {

    setEditingId(sentence.id);



    setForm({

      russian: sentence.russian,

      russianWord: sentence.russianWord || "",
      englishTemplate: sentence.englishTemplate,

      word: sentence.word,
      pixabayQuery: sentence.pixabayQuery || "",
      pixabayQueryVersion: 2,
      level: sentence.level || "A1",

    });



    setError("");

    window.scrollTo({ top: 0, behavior: "smooth" });

  }



  function submit(event) {

    event.preventDefault();

    setError("");



    const russian = form.russian.trim();
    const russianWord = form.russianWord.trim();
    const englishTemplate = form.englishTemplate.trim();

    const word = form.word.trim();



    if (!russian || !russianWord || !englishTemplate || !word) {

      setError("Заполни все обязательные поля.");

      return;

    }



    if (/\s/.test(word)) {

      setError("В этой версии указывай одно слово без пробелов.");

      return;

    }



    const placeholderCount = (

      englishTemplate.match(/\{word\}/g) || []

    ).length;



    if (placeholderCount !== 1) {

      setError(

        "Укажи {word} ровно один раз в английском шаблоне."

      );

      return;

    }



    onSave({

      id: editingId || createId(),

      russian,

      russianWord,
      englishTemplate,

      word,
      pixabayQuery: form.pixabayQuery.trim(),
      pixabayQueryVersion: 2,
      level: form.level,

    });



    resetForm();

  }



  return (

    <div className="admin-layout">

      <section className="panel admin-video-panel">
        <h2>Библиотека видео</h2>
        <p className="muted">Добавляй YouTube-ролики здесь. Они появятся в разделе «Видео».</p>
        <form className="admin-form" onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const title = String(formData.get("videoTitle") || "").trim();
          const url = String(formData.get("videoUrl") || "").trim();
          const level = String(formData.get("videoLevel") || "B1");
          if (!title || !url) return;
          try {
            const parsedUrl = new URL(url);
            const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
            if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
              window.alert("Пока можно добавлять только ссылки YouTube.");
              return;
            }
          } catch {
            window.alert("Введи корректную ссылку YouTube.");
            return;
          }
          onSaveVideo({ id: createId(), title, url, level, transcript: "" });
          event.currentTarget.reset();
        }}>
          <label>Название ролика
            <input name="videoTitle" required placeholder="Например: Ordering food in a café" />
          </label>
          <label>Ссылка на YouTube
            <input name="videoUrl" type="url" required placeholder="https://www.youtube.com/watch?v=..." />
          </label>
          <label>Уровень
            <select name="videoLevel" defaultValue="B1">
              {["A1", "A2", "B1", "B2", "C1"].map((level) => <option key={level}>{level}</option>)}
            </select>
          </label>
          <div className="form-actions">
            <button className="button button-primary" type="submit">Добавить видео</button>
          </div>
        </form>
        <div className="sentence-list">
          {videos.length === 0 ? <p className="muted">Видео пока не добавлены.</p> : videos.map((video) => (
            <article className="admin-video-item" key={video.id}>
              <div className="admin-video-preview-column">
                <div className="admin-video-preview">
                  {getYouTubeVideoId(video.url) ? (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${getYouTubeVideoId(video.url)}?rel=0`}
                      title={`Предпросмотр: ${video.title}`}
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : <span>Не удалось открыть предпросмотр</span>}
                </div>
                <strong>{video.title}</strong>
                <span className="muted">{video.level || "B1"}</span>
              </div>
              <div className="admin-video-settings">
                <div className="admin-video-range">
                  <VideoTimeFields label="Начало фрагмента" value={video.startTime || "0:00"}
                    onSave={(startTime) => onSaveVideo({ ...video, startTime })} />
                  <VideoTimeFields label="Конец фрагмента" value={video.endTime || ""}
                    allowEmpty onSave={(endTime) => onSaveVideo({ ...video, endTime })} />
                  <small className="muted">Оставь минуты и секунды конца пустыми, чтобы использовать остаток ролика.</small>
                </div>
                <div className="admin-video-actions">
                  <button type="button" className="button button-primary"
                    disabled={subtitleJobs[video.id] === "loading"}
                    onClick={() => fetchVideoSubtitles(video)}>
                    {subtitleJobs[video.id] === "loading"
                      ? "Загружаю титры…"
                      : video.transcript ? "Обновить титры" : "Получить титры"}
                  </button>
                  {video.transcript && <span className="muted">Титры загружены</span>}
                  {Array.isArray(video.subtitleCues) && video.subtitleCues.length > 0 && (
                    <details className="admin-subtitle-debug">
                      <summary>Показать субтитры и таймкоды ({video.subtitleCues.length})</summary>
                      <div style={{ maxHeight: "320px", overflowY: "auto", marginTop: "10px" }}>
                        {video.subtitleCues.map((cue, cueIndex) => (
                          <div key={cueIndex} style={{ padding: "7px 0", borderBottom: "1px solid var(--border-color, #ddd)" }}>
                            <small className="muted">
                              {Number(cue.start).toFixed(2)}–{Number(cue.end).toFixed(2)} сек.
                            </small>
                            <div>{cue.text}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {subtitleErrors[video.id] && <p className="form-error" role="alert">{subtitleErrors[video.id]}</p>}
                  <button type="button" className="button button-danger" onClick={() => {
                    if (window.confirm("Удалить это видео из библиотеки?")) onDeleteVideo(video.id);
                  }}>Удалить</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">

        <h2>

          {editingId

            ? "Редактировать предложение"

            : "Добавить предложение"}

        </h2>



        <p className="muted">

          Используй {"{word}"} вместо пропущенного слова.

        </p>



        <form className="admin-form" onSubmit={submit}>

          <label>

            Предложение на русском

            <textarea

              rows={2}

              required

              value={form.russian}

              onChange={(event) =>

                update("russian", event.target.value)

              }

              placeholder="Я оставил пальто в машине."

            />

          </label>          <label>
            Слово для перевода на русском
            <input required value={form.russianWord}
              onChange={(event) => update("russianWord", event.target.value)}
              placeholder="пальто" />
          </label>

          <label>

            Английский шаблон

            <input

              required

              value={form.englishTemplate}

              onChange={(event) =>

                update("englishTemplate", event.target.value)

              }

              placeholder="I left my {word} in the car."

            />

          </label>



          <label>

            Пропущенное слово

            <input

              required

              value={form.word}

              onChange={(event) =>

                update("word", event.target.value)

              }

              placeholder="coat"

            />

          </label>



          

            <label>
            Поисковый запрос для картинки (Pixabay)
            <input
              value={form.pixabayQuery}
              onChange={(event) => update("pixabayQuery", event.target.value)}
              placeholder="friendly neighbours talking"
            />
            <small className="muted">Опиши сцену на английском. Если оставить пустым, запрос будет составлен из предложения и слова.</small>
          </label>

          <label>

            Уровень английского

            <select

              value={form.level}

              onChange={(event) =>

                update("level", event.target.value)

              }

            >

              {["A1", "A2", "B1", "B2", "C1"].map((level) => (

                <option key={level} value={level}>

                  {level}

                </option>

              ))}

            </select>

          </label>



          {error && (

            <p className="form-error" role="alert">

              {error}

            </p>

          )}



          <div className="form-actions">

            <button className="button button-primary" type="submit">

              {editingId

                ? "Сохранить изменения"

                : "Добавить предложение"}

            </button>



            {editingId && (

              <button

                type="button"

                className="button button-secondary"

                onClick={resetForm}

              >

                Отмена

              </button>

            )}

          </div>

        </form>

      </section>



      <section className="panel">

        <h2>Предложения ({safeSentences.length})</h2>

        <div className="admin-level-tabs" role="tablist" aria-label="Уровень предложений">
          {adminLevels.map((level) => {
            const count = safeSentences.filter(
              (sentence) => (sentence.level || "B1") === level
            ).length;
            return (
              <button
                key={level}
                type="button"
                role="tab"
                aria-selected={activeLevel === level}
                className={activeLevel === level ? "admin-level-tab active" : "admin-level-tab"}
                onClick={() => setActiveLevel(level)}
              >
                {level} <span>({count})</span>
              </button>
            );
          })}
        </div>

        {(() => {
          const levelSentences = safeSentences.filter(
            (sentence) => (sentence.level || "B1") === activeLevel
          );
          if (levelSentences.length === 0) {
            return <p className="muted">На уровне {activeLevel} пока нет предложений.</p>;
          }
          return (
            <div className="admin-level-group">
              {levelSentences.map((sentence) => (
                <article className="sentence-item" key={sentence.id}>
                  <div>
                    <strong>{String(sentence.russian || "").replace(/\.+\s*$/, "")}</strong>
                    <p className="sentence-item-english">
                      {(sentence.englishTemplate || "").replace(/\.+\s*$/, "").replace("{word}", `[${sentence.word || ""}]`)}
                    </p>
                  </div>
                  <div className="sentence-item-actions">
                    <button className="button button-secondary" onClick={() => editSentence(sentence)}>
                      Изменить
                    </button>
                    <button
                      className="button button-danger"
                      onClick={() => {
                        if (window.confirm("Удалить это предложение?")) {
                          onDelete(sentence.id);
                          if (editingId === sentence.id) resetForm();
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </article>
              ))}
            </div>
          );
        })()}
      </section>



    </div>

  );

}



// Главный компонент приложения.
export default function App() {
  const [sentences, setSentences] = useState(loadSentences);
  const [videos, setVideos] = useState(loadVideos);
  const [completedVideoIds, setCompletedVideoIds] = useState(loadCompletedVideoIds);
  const [page, setPage] = useState("study");
  const [showStats, setShowStats] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState("A1");
  const [statsLevel, setStatsLevel] = useState("A1");
  const [learningData, setLearningData] = useState(loadLearningData);
  const [activeWordKey, setActiveWordKey] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(() => {
    try {
      return localStorage.getItem("english-word-trainer-audio") !== "off";
    } catch {
      return true;
    }
  });
  const levels = LEVELS;

  function toggleAudio() {
    setAudioEnabled((enabled) => {
      const next = !enabled;
      try {
        localStorage.setItem("english-word-trainer-audio", next ? "on" : "off");
      } catch (error) {
        console.error("Не удалось сохранить настройку звука:", error);
      }
      if (!next && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }

  // Build the level index once per sentence-data change. All five levels stay
  // resident in memory, so switching levels does not filter the full dataset again.
  const sentencesByLevel = useMemo(() => {
    const grouped = Object.fromEntries(LEVELS.map((level) => [level, []]));
    sentences.forEach((item) => {
      if (item && grouped[item.level]) grouped[item.level].push(item);
    });
    return grouped;
  }, [sentences]);

  const filteredSentences = sentencesByLevel[selectedLevel] || [];
  const candidate = useMemo(
    () => selectNextSentence(filteredSentences, learningData),
    [filteredSentences, learningData]
  );
  const sentence = useMemo(() => activeWordKey
    ? filteredSentences.find((item) => normalizeWord(item.word) === activeWordKey) || candidate
    : candidate, [filteredSentences, activeWordKey, candidate]);

  const levelWords = useMemo(
    () => new Set(filteredSentences.map((item) => normalizeWord(item.word)).filter(Boolean)),
    [filteredSentences]
  );
  const totalWords = levelWords.size;
  const masteredCount = useMemo(
    () => Array.from(levelWords).filter((word) => learningData.words[word]?.status === "MASTERED").length,
    [levelWords, learningData.words]
  );
  const sentenceByWord = useMemo(() => {
    const index = new Map();
    sentences.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const key = normalizeWord(item.word);
      if (key && !index.has(key)) index.set(key, item);
    });
    return index;
  }, [sentences]);
  const levelProgress = useMemo(() => LEVELS.map((level) => {
    const words = new Set((sentencesByLevel[level] || [])
      .map((item) => normalizeWord(item.word)).filter(Boolean));
    const mastered = Array.from(words).filter((word) =>
      learningData.words[word]?.status === "MASTERED"
    ).length;
    return {
      level,
      total: words.size,
      mastered,
      percent: words.size ? Math.round((mastered / words.size) * 100) : 0,
    };
  }), [sentencesByLevel, learningData.words]);
  const reviewQueue = useMemo(() => Object.entries(learningData.words)
    .filter(([key, state]) => state.status === "REVIEW" && sentenceByWord.has(key))
    .map(([key, state]) => ({
      key,
      word: sentenceByWord.get(key)?.word || key,
      level: sentenceByWord.get(key)?.level || "—",
      stage: state.stage,
      dueAt: state.dueAt,
      order: state.order || 0,
    }))
    .sort((a, b) => (a.dueAt - b.dueAt) || (a.order - b.order)),
  [learningData.words, sentenceByWord]);
  const readyReviewCount = useMemo(
    () => reviewQueue.filter((item) => item.dueAt <= learningData.completedCount).length,
    [reviewQueue, learningData.completedCount]
  );
  const reviewWords = useMemo(() => reviewQueue.map((item, index, items) => {
    const readyBefore = items.slice(0, index).filter(
      (previous) => previous.dueAt <= learningData.completedCount
    ).length;
    const sameFutureDueBefore = items.slice(0, index).filter(
      (previous) => previous.dueAt === item.dueAt &&
        previous.dueAt > learningData.completedCount
    ).length;
    const remaining = item.dueAt <= learningData.completedCount
      ? readyBefore + 1
      : item.dueAt - learningData.completedCount + readyReviewCount + sameFutureDueBefore;
    return { ...item, remaining };
  }), [reviewQueue, learningData.completedCount, readyReviewCount]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sentences));
    } catch (error) {
      console.error("Не удалось сохранить предложения:", error);
    }
  }, [sentences]);

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_LIBRARY_KEY, JSON.stringify(videos));
    } catch (error) {
      console.error("Не удалось сохранить библиотеку видео:", error);
    }
  }, [videos]);

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_PROGRESS_KEY, JSON.stringify(completedVideoIds));
    } catch (error) {
      console.error("Не удалось сохранить прогресс по видео:", error);
    }
  }, [completedVideoIds]);

  useEffect(() => {
    try {
      localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(learningData));
    } catch (error) {
      console.error("Не удалось сохранить прогресс:", error);
    }
  }, [learningData]);

  function completeWord(word, isCorrect) {
    const key = normalizeWord(word);
    setActiveWordKey(key);
    setLearningData((previous) => recordWordAnswer(previous, word, isCorrect));
  }

  function markWordKnown(word) {
    const key = normalizeWord(word);
    setActiveWordKey(key);
    setLearningData((previous) => {
      const old = previous.words[key];
      return {
        ...previous,
        words: {
          ...previous.words,
          [key]: { status: "MASTERED", stage: 6, masteredAt: previous.completedCount, markedKnown: true },
        },
      };
    });
  }

  const advanceCard = useCallback(() => {
    setActiveWordKey(null);
  }, []);

  // Keep the study layout mounted; only replace the selected level's data.
  function changeLevel(level) {
    if (level === selectedLevel) return;
    setActiveWordKey(null);
    setSelectedLevel(level);
  }

  function saveSentence(sentence) {
    setSentences((current) => {
      const exists = current.some((item) => item.id === sentence.id);
      if (exists) return current.map((item) => item.id === sentence.id ? sentence : item);
      return [...current, sentence];
    });
  }

  function deleteSentence(id) {
    setSentences((current) => current.filter((item) => item.id !== id));
  }

  function saveVideo(video) {
    setVideos((current) => {
      const exists = current.some((item) => item.id === video.id);
      return exists ? current.map((item) => item.id === video.id ? video : item) : [...current, video];
    });
  }

  function deleteVideo(id) {
    setVideos((current) => current.filter((item) => item.id !== id));
    setCompletedVideoIds((current) => current.filter((itemId) => itemId !== id));
  }

  const completeVideo = useCallback((id) => {
    if (!id) return;
    setCompletedVideoIds((current) => current.includes(id) ? current : [...current, id]);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">Aa</div>
          <div>
            <h1>English Word Trainer</h1>
            <p>Мама, я все выучил!</p>
          </div>
        </div>
        <div className="header-actions">
          <nav className="main-nav">
            <button
              type="button"
              className={page === "study" && !showStats ? "nav-button nav-main-button active" : "nav-button nav-main-button"}
              onClick={() => {
                setPage("study");
                setShowStats(false);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c2.8-.9 5.5-.4 8 1.5v13c-2.5-1.9-5.2-2.4-8-1.5zM20 5.5c-2.8-.9-5.5-.4-8 1.5v13c2.5-1.9 5.2-2.4 8-1.5z" /></svg>
              <span>Слова</span>
            </button>
            <button
              type="button"
              className={page === "audition" ? "nav-button nav-main-button active" : "nav-button nav-main-button"}
              onClick={() => {
                setPage("audition");
                setShowStats(false);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H6a2 2 0 0 1-2-2zM20 13h-3v7h1a2 2 0 0 0 2-2z" /></svg>
              <span>Аудирование</span>
            </button>
            <button
              type="button"
              className={page === "video" ? "nav-button nav-main-button active" : "nav-button nav-main-button"}
              onClick={() => {
                setPage("video");
                setShowStats(false);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="12" rx="3" /><path d="m17 10 4-2v8l-4-2z" /></svg>
              <span>Видео</span>
            </button>
          </nav>
          <div className="header-utility-controls">
            <button
              type="button"
              className={page === "admin" ? "nav-button nav-utility-button active" : "nav-button nav-utility-button"}
              onClick={() => {
                setPage("admin");
                setShowStats(false);
              }}
            >Админка</button>
            <button
              type="button"
              className={page === "study" && showStats ? "nav-button nav-utility-button active" : "nav-button nav-utility-button"}
              onClick={() => {
                if (page === "study" && showStats) {
                  setShowStats(false);
                } else {
                  setPage("study");
                  setShowStats(true);
                }
              }}
            >Статистика</button>
            <button
              className={"sound-toggle" + (audioEnabled ? "" : " sound-toggle-off")}
              type="button"
              onClick={toggleAudio}
              aria-label={audioEnabled ? "Выключить озвучивание" : "Включить озвучивание"}
              aria-pressed={audioEnabled}
              title={audioEnabled ? "Выключить звук" : "Включить звук"}
            >
              {audioEnabled ? "🔊" : "🔇"}
            </button>
          </div>
        </div>
      </header>
      <main className="main-content">
        <div key={`${page}-${page === "study" ? (showStats ? "stats" : "words") : "screen"}`} className="app-screen-transition">
        {page === "study" ? (
          <div className="study-level-transition">
          <StudyPage
            sentence={sentence}
            audioEnabled={audioEnabled}
            selectedLevel={selectedLevel}
            setSelectedLevel={changeLevel}
            levels={levels}
            levelWordCount={totalWords}
            onComplete={completeWord}
            onKnow={() => markWordKnown(sentence?.word)}
            isReview={Boolean(sentence && learningData.words[normalizeWord(sentence.word)]?.status === "REVIEW")}
            reviewStage={learningData.words[normalizeWord(sentence?.word)]?.stage || 1}
            onAdvance={advanceCard}
            masteredCount={masteredCount}
            totalWords={totalWords}
            completedCount={learningData.completedCount}
            reviewWords={reviewWords}
            stats={learningData.stats || { totalAnswers: 0, correctAnswers: 0, streak: 0, daily: { date: getLocalDateKey(), count: 0 } }}
            levelProgress={levelProgress}
            showStats={showStats}
            setShowStats={setShowStats}
            statsLevel={statsLevel}
            setStatsLevel={setStatsLevel}
          />
          </div>
        ) : page === "audition" ? (
          <AuditionPage
            sentences={sentences}
            selectedLevel={selectedLevel}
            setSelectedLevel={changeLevel}
            levels={levels}
            audioEnabled={audioEnabled}
          />
        ) : page === "video" ? (
          <VideoPage videos={videos} completedVideoIds={completedVideoIds} onCompleteVideo={completeVideo} />
        ) : (
          <AdminPage sentences={sentences} onSave={saveSentence} onDelete={deleteSentence} videos={videos} onSaveVideo={saveVideo} onDeleteVideo={deleteVideo} />
        )}
        </div>
      </main>
      <footer className="app-footer">English Word Trainer · MVP v1</footer>
    </div>
  );
}
