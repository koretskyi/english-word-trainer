import { SENTENCES } from "./sentences.js";
import { useCallback, useEffect, useRef, useState } from "react";




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
            ? { ...sentence, ...savedSentence, russianWord: savedSentence.russianWord || sentence.russianWord }
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

function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
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


function WordGap({ sentence, value, onChange, disabled, containerRef, showMistakes = false }) {
  const letters = [...sentence.word];
  // Открываем одну случайную букву на каждые полные 3 буквы слова.
  // Выбор фиксируется на время показа карточки и меняется при переходе к новой.
  const [opened] = useState(() => {
    const count = Math.floor(letters.length / 3);
    const positions = letters.map((_, index) => index);

    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    return new Set(positions.slice(0, count));
  });
  const inputRefs = useRef([]);

  // Открытые буквы показываются как подсказки,
  // но пользователь должен ввести каждую букву самостоятельно.
  function focusAt(index) {
    if (index >= 0 && index < letters.length) {
      inputRefs.current[index]?.focus();
      return true;
    }

    return false;
  }

  // При открытии карточки фокусируемся на первой пустой позиции.
  useEffect(() => {
    if (disabled) return;

    const firstEmpty = value.findIndex(
      (letter) => !letter
    );

    if (firstEmpty >= 0) {
      focusAt(firstEmpty);
    }
  }, [sentence.id, sentence.word, disabled]);

  function handleChange(index, rawValue) {
    const character = [...rawValue].slice(-1)[0] || "";

    if (character && !/^[a-z]$/i.test(character)) {
      return;
    }

    const next = [...value];
    next[index] = character;

    onChange(next);

    // После ввода переходим на следующую пустую позицию.
    // Открытые буквы не пропускаются, пока не введены.
    if (character) {
      let nextIndex = index + 1;

      while (
        nextIndex < letters.length &&
        next[nextIndex]
      ) {
        nextIndex++;
      }

      if (nextIndex < letters.length) {
        focusAt(nextIndex);
      }
    }
  }

  function handleKeyDown(index, event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
      return;
    }

    if (event.key === "Backspace" && !value[index]) {
      event.preventDefault();

      let previous = index - 1;

      while (previous >= 0 && !value[previous]) {
        previous--;
      }

      if (previous >= 0) {
        const next = [...value];
        next[previous] = "";
        onChange(next);
        focusAt(previous);
      }
    }
  }

  return (
    <span
      ref={containerRef}
      className="word-gap-container"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "5px",
        whiteSpace: "nowrap",
        verticalAlign: "baseline",
      }}
    >
      {letters.map((letter, index) => {
        const isOpened = opened.has(index);
        const isMistake = showMistakes && Boolean(value[index]) &&
          value[index].toLowerCase() !== letter.toLowerCase();

        return (
          <input
            key={`${sentence.id}-${index}`}
            ref={(element) => {
              inputRefs.current[index] = element;
            }}
            className={`word-gap${isMistake ? " word-gap-mistake" : ""}`}
            type="text"
            inputMode="text"
            maxLength={1}
            value={value[index] || ""}
            placeholder={isOpened ? letter : "*"}
            onChange={(event) =>
              handleChange(index, event.target.value)
            }
            onKeyDown={(event) =>
              handleKeyDown(index, event)
            }
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label={`Буква ${index + 1}`}
            style={{
              width: "calc(1.2em + 2px)",
              minWidth: "calc(1.2em + 2px)",
              maxWidth: "calc(1.2em + 2px)",
              flex: "0 0 calc(1.2em + 2px)",
              height: "calc(1.65em + 2px)",
              margin: 0,
              padding: "0 1px",
              textAlign: "center",
              font: "inherit",
              fontSize: "calc(1em + 1px)",
              lineHeight: 1.2,
              border: "none",
              borderBottom: `2px solid ${
                isMistake ? "#dc2626" : isOpened ? "#15803d" : "#3157d5"
              }`,
              borderRadius: 0,
              backgroundColor: isMistake
                ? "#fee2e2"
                : isOpened ? "#e7f6eb" : "#f0f3ff",
              color: isMistake ? "#dc2626" : isOpened ? "#15803d" : "#172033",
              fontWeight: isMistake || isOpened ? 700 : 400,
              outlineOffset: "1px",
              opacity: 1,
            }}
          />
        );
      })}
    </span>
  );
}



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

// Страница обучения с интервальным повторением.
function StudyPage({
  sentence,
  audioEnabled,
  selectedLevel,
  setSelectedLevel,
  levels,
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
  isReview,
  onKnow,
}) {
  const [answer, setAnswer] = useState(() => createInitialAnswer(sentence));
  const [checked, setChecked] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [markedKnown, setMarkedKnown] = useState(false);
  const targetLetters = sentence ? [...sentence.word] : [];
  const correct = Boolean(sentence) && targetLetters.length > 0 &&
    targetLetters.every((letter, position) =>
      (answer[position] || "").toLowerCase() === letter.toLowerCase()
    );

  useEffect(() => {
    if (!checked || (correct && !successVisible)) return undefined;
    const timer = setTimeout(onAdvance, correct ? 1000 : 4000);
    return () => clearTimeout(timer);
  }, [checked, correct, successVisible, onAdvance]);

  const englishText = sentence
    ? sentence.englishTemplate.replace("{word}", sentence.word)
    : "";

  // При открытии карточки ничего не озвучиваем.
  // Озвучка правильного слова запускается непосредственно после верного ответа.

  const parts = sentence ? sentence.englishTemplate.split("{word}") : [];
  const levelSelector = (
    <div className="level-selector">
      <label htmlFor="study-level">Уровень:</label>
      <select id="study-level" value={selectedLevel}
        onChange={(event) => setSelectedLevel(event.target.value)}>
        {levels.map((level) => <option key={level} value={level}>{level}</option>)}
      </select>
      <span>{masteredCount} / {totalWords} выучено на {selectedLevel}</span>

    </div>
  );

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

      <h4>Слова на повторении</h4>
      {reviewWords.length === 0 ? (
        <p>Пока нет слов на повторении.</p>
      ) : (
        <ul className="stats-review-list">
          {reviewWords.map((item) => (
            <li key={item.key} className="review-word-item">
              <strong className="review-word-name">{item.word}</strong>
              <span className="review-word-stage">{item.level} · этап {item.stage} из 6</span>
              <span className="review-word-countdown">
                {item.remaining === 0 ? "Готово к повтору" : <>Повтор через <strong className="review-word-number">{item.remaining}</strong> карточек</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

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
        if (audioEnabled) {
          const started = speakEnglish(englishText, () => setSuccessVisible(true));
          if (!started) setSuccessVisible(true);
        } else {
          setSuccessVisible(true);
        }
      }
    }
  }

  function dontKnow() {
    if (!sentence || checked) return;
    setChecked(true);
    onComplete(sentence.word, false);
  }

  function knowWord() {
    if (!sentence || !isReview || checked) return;
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

  return (
    <section className="panel study-panel">
      {levelSelector}
      {statsPanel}
      <div className="card-topline">
        <span>Прогресс обучения</span>
        <span className="level-badge">{sentence.level}</span>
      </div>
      {isReview && (
        <div className="review-origin-label" style={{ margin: "12px 0", padding: "8px 12px", borderRadius: "8px", background: "#fff4d6", color: "#805500", fontWeight: 600 }}>
          ↻ Это слово пришло из повторения
        </div>
      )}
      <div className="progress-track">
        <div className="progress-fill" style={{
          width: (totalWords ? (masteredCount / totalWords) * 100 : 0) + "%",
          backgroundColor: "#A8E64A",
        }} />
      </div>
      <p className="eyebrow">ПЕРЕВЕДИТЕ НА АНГЛИЙСКИЙ</p>
      <h2 className="russian-sentence">{sentence.russian}</h2>
      <div className="english-section">
        <p className="study-instruction">ВПИШИТЕ СЛОВО ПРЯМО В ПРЕДЛОЖЕНИЕ: <strong className="target-translation" style={{ fontSize: "18px" }}>{sentence.russianWord || "—"}</strong></p>
        <div className="answer-area">
          <div className="english-sentence">
            <span>{parts[0]}</span>
            <WordGap key={`${sentence.id}-${sentence.word}`} sentence={sentence} value={answer}
              onChange={handleAnswerChange} disabled={checked}
              showMistakes={checked && !correct} />
            <span>{parts.slice(1).join("{word}")}</span>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              if (audioEnabled) speakEnglish(englishText);
            }}
            disabled={!audioEnabled}
            aria-label="Повторить английское предложение"
            style={{ marginTop: "10px" }}
          >
            🔊 Повторить
          </button>
          {!checked ? (
            <div className="form-actions">
              <button className="button button-secondary button-dont-know" type="button"
                onClick={dontKnow}>Не знаю</button>
              {isReview && (
                <button className="button button-primary" type="button"
                  onClick={knowWord}>Я знаю</button>
              )}
            </div>
          ) : !correct && !markedKnown ? (
            <div className="feedback incorrect">
              <strong className="incorrect-feedback-title">✗ Ошибка</strong>
              <div className="incorrect-answer-comparison" aria-label="Правильный ответ и твой вариант">
                <div className="answer-comparison-row">
                  <span className="answer-comparison-label">Правильный ответ</span>
                  <div className="answer-comparison-line correct-word-line">{sentence.word}</div>
                </div>
                <div className="answer-comparison-row">
                  <span className="answer-comparison-label">Ваш ответ</span>
                  <div className="answer-comparison-line user-word-line">
                    {targetLetters.map((letter, index) => {
                      const userLetter = answer[index] || "";
                      const isMistake = userLetter.toLowerCase() !== letter.toLowerCase();
                      return (
                        <span key={index} className={isMistake ? "user-word-letter-mistake" : ""}>
                          {userLetter || "_"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : markedKnown ? (
            <div className="feedback correct">
              <strong>✓ Слово перенесено в выученные</strong>
              <p>Больше не будет появляться в обучении.</p>
            </div>
          ) : null}}
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

  revealPositions: "",

  level: "B1",

};



// Локальная админка.

function AdminPage({ sentences, onSave, onDelete }) {

  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [editingId, setEditingId] = useState(null);

  const [error, setError] = useState("");



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

      revealPositions: (sentence.revealIndices || [])

        .map((position) => position + 1)

        .join(", "),

      level: sentence.level || "B1",

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



    const positions = form.revealPositions.trim()

      ? form.revealPositions

          .split(",")

          .map((item) => Number(item.trim()) - 1)

      : [];



    if (

      positions.some(

        (position) =>

          !Number.isInteger(position) ||

          position < 0 ||

          position >= [...word].length

      )

    ) {

      setError(

        `Номера открытых букв должны быть от 1 до ${[...word].length}.`

      );

      return;

    }



    onSave({

      id: editingId || createId(),

      russian,

      russianWord,
      englishTemplate,

      word,

      revealIndices: [...new Set(positions)],

      level: form.level,

    });



    resetForm();

  }



  return (

    <div className="admin-layout">

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

            Позиции открытых букв (нумерация с 1)

            <input

              value={form.revealPositions}

              onChange={(event) =>

                update("revealPositions", event.target.value)

              }

              placeholder="Например: 3 или 1, 4"

            />

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

        <h2>Все предложения ({sentences.length})</h2>



        {sentences.length === 0 && (

          <p className="muted">Предложений пока нет.</p>

        )}



        {sentences.map((sentence) => (

          <article className="sentence-item" key={sentence.id}>

            <div>

              <strong>{sentence.russian}</strong>



              <p className="sentence-item-english">

                {sentence.englishTemplate.replace(

                  "{word}",

                  `[${sentence.word}]`

                )}

              </p>



              <span className="muted">{sentence.level}</span>

            </div>



            <div className="sentence-item-actions">

              <button

                className="button button-secondary"

                onClick={() => editSentence(sentence)}

              >

                Изменить

              </button>



              <button

                className="button button-danger"

                onClick={() => {

                  if (window.confirm("Удалить это предложение?")) {

                    onDelete(sentence.id);



                    if (editingId === sentence.id) {

                      resetForm();

                    }

                  }

                }}

              >

                Удалить

              </button>

            </div>

          </article>

        ))}

      </section>

    </div>

  );

}



// Главный компонент приложения.
export default function App() {
  const [sentences, setSentences] = useState(loadSentences);
  const [page, setPage] = useState("study");
  const [showStats, setShowStats] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState("A1");
  const [learningData, setLearningData] = useState(loadLearningData);
  const [activeWordKey, setActiveWordKey] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(() => {
    try {
      return localStorage.getItem("english-word-trainer-audio") !== "off";
    } catch {
      return true;
    }
  });
  const levels = ["A1", "A2", "B1", "B2", "C1"];

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

  const filteredSentences = sentences.filter((sentence) => sentence && sentence.level === selectedLevel);
  const candidate = selectNextSentence(filteredSentences, learningData);
  const sentence = activeWordKey
    ? filteredSentences.find((item) => normalizeWord(item.word) === activeWordKey) || candidate
    : candidate;

  const levelWords = new Set(filteredSentences.map((item) => normalizeWord(item.word)).filter(Boolean));
  const totalWords = levelWords.size;
  const masteredCount = Array.from(levelWords).filter((word) =>
    learningData.words[word] && learningData.words[word].status === "MASTERED"
  ).length;
  const sentenceByWord = new Map();
  sentences.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const key = normalizeWord(item.word);
    if (key && !sentenceByWord.has(key)) sentenceByWord.set(key, item);
  });
  const levelProgress = levels.map((level) => {
    const words = new Set(sentences
      .filter((item) => item && item.level === level)
      .map((item) => normalizeWord(item.word))
      .filter(Boolean));
    const mastered = Array.from(words).filter((word) =>
      learningData.words[word]?.status === "MASTERED"
    ).length;
    return {
      level,
      total: words.size,
      mastered,
      percent: words.size ? Math.round((mastered / words.size) * 100) : 0,
    };
  });
  const reviewWords = Object.entries(learningData.words)
    .filter(([key, state]) => state.status === "REVIEW" && sentenceByWord.has(key))
    .map(([key, state]) => ({
      key,
      word: sentenceByWord.get(key)?.word || key,
      level: sentenceByWord.get(key)?.level || "—",
      stage: state.stage,
      remaining: Math.max(0, state.dueAt - learningData.completedCount),
      dueAt: state.dueAt,
      order: state.order || 0,
    }))
    .sort((a, b) => (a.remaining - b.remaining) || (a.order - b.order));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sentences));
    } catch (error) {
      console.error("Не удалось сохранить предложения:", error);
    }
  }, [sentences]);

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
      if (!old || old.status !== "REVIEW") return previous;
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

  function changeLevel(level) {
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">Aa</div>
          <div>
            <h1>English Word Trainer</h1>
            <p>Учи слова в контексте</p>
          </div>
        </div>
        <div className="header-actions">
          <nav className="main-nav">
            <button className={page === "study" ? "nav-button active" : "nav-button"}
              onClick={() => setPage("study")}>Обучение</button>
            <button className={page === "admin" ? "nav-button active" : "nav-button"}
              onClick={() => setPage("admin")}>Админка</button>
            <button className={showStats ? "nav-button active" : "nav-button"}
              onClick={() => {
                setPage("study");
                setShowStats((value) => !value);
              }}>Статистика</button>
          </nav>
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
      </header>
      <main className="main-content">
        {page === "study" ? (
          <StudyPage
            key={selectedLevel + ":" + (sentence ? normalizeWord(sentence.word) : "empty")}
            sentence={sentence}
            audioEnabled={audioEnabled}
            selectedLevel={selectedLevel}
            setSelectedLevel={changeLevel}
            levels={levels}
            onComplete={completeWord}
            onKnow={() => markWordKnown(sentence?.word)}
            isReview={Boolean(sentence && learningData.words[normalizeWord(sentence.word)]?.status === "REVIEW")}
            onAdvance={advanceCard}
            masteredCount={masteredCount}
            totalWords={totalWords}
            completedCount={learningData.completedCount}
            reviewWords={reviewWords}
            stats={learningData.stats || { totalAnswers: 0, correctAnswers: 0, streak: 0, daily: { date: getLocalDateKey(), count: 0 } }}
            levelProgress={levelProgress}
            showStats={showStats}
            setShowStats={setShowStats}
          />
        ) : (
          <AdminPage sentences={sentences} onSave={saveSentence} onDelete={deleteSentence} />
        )}
      </main>
      <footer className="app-footer">English Word Trainer · MVP v1</footer>
    </div>
  );
}
