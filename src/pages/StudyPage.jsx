import { useState } from "react";
import WordGap from "../components/WordGap";

export default function StudyPage({
  sentence,
  index,
  total,
  onPrevious,
  onNext,
}) {
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);

  if (!sentence) {
    return (
      <section className="panel">
        <h2>Пока нет предложений</h2>
        <p>Добавь предложения через раздел «Админка».</p>
      </section>
    );
  }

  const isCorrect =
    answer.trim().toLocaleLowerCase() ===
    sentence.word.trim().toLocaleLowerCase();
  const parts = sentence.englishTemplate.split("{word}");

  function handleCheck(event) {
    event.preventDefault();
    if (answer.trim()) setChecked(true);
  }

  function handleRetry() {
    setAnswer("");
    setChecked(false);
  }

  return (
    <section className="panel study-panel">
      <div className="card-topline">
        <span>Карточка {index + 1} из {total}</span>
        <span className="level-badge">{sentence.level}</span>
      </div>

      <div className="progress-track" aria-label="Прогресс по карточкам">
        <div
          className="progress-fill"
          style={{ width: `${((index + 1) / total) * 100}%` }}
        />
      </div>

      <p className="eyebrow">ПЕРЕВЕДИТЕ НА АНГЛИЙСКИЙ</p>
      <h2 className="russian-sentence">{sentence.russian}</h2>

      <div className="english-section">
        <p className="eyebrow">ВСТАВЬТЕ ПРОПУЩЕННОЕ СЛОВО</p>

        <form onSubmit={handleCheck}>
          <div className="english-sentence">
            <span className="preserve-space">{parts[0]}</span>
            <WordGap
              answer={sentence.word}
              revealIndices={sentence.revealIndices}
              value={answer}
              onChange={setAnswer}
              disabled={checked}
            />
            <span className="preserve-space">{parts.slice(1).join("{word}")}</span>
          </div>

          <p className="hint-text">
            * — скрытая буква. Открытые буквы показаны на своих местах.
          </p>

          {!checked ? (
            <button className="button button-primary" type="submit" disabled={!answer.trim()}>
              Проверить ответ
            </button>
          ) : (
            <div className="answer-feedback" aria-live="polite">
              {isCorrect ? (
                <p className="feedback-correct">✓ Правильно!</p>
              ) : (
                <p className="feedback-incorrect">✗ Не совсем правильно</p>
              )}
              {!isCorrect && (
                <p>Правильный ответ: <strong>{sentence.word}</strong></p>
              )}
              <p>{sentence.englishTemplate.replace("{word}", sentence.word)}</p>
              <button className="button button-secondary" type="button" onClick={handleRetry}>
                Попробовать ещё раз
              </button>
            </div>
          )}
        </form>
      </div>

      <div className="card-navigation">
        <button className="button button-secondary" onClick={onPrevious} disabled={index <= 0}>
          ← Назад
        </button>
        <button className="button button-primary" onClick={onNext} disabled={index >= total - 1}>
          Далее →
        </button>
      </div>
    </section>
  );
}
