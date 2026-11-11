import { useEffect, useRef, useState } from "react";

function WordGap({ sentence, value, onChange, disabled, containerRef, showMistakes = false, autoFocus = true, nextInputRef }) {
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
    if (disabled || !autoFocus) return;

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
      } else {
        nextInputRef?.current?.focus();
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
              if (index === 0 && nextInputRef?.setCurrentInput) {
                nextInputRef.setCurrentInput(element);
              }
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

export default WordGap;
