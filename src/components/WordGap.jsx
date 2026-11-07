export default function WordGap({
  answer,
  revealIndices = [],
  value,
  onChange,
  disabled = false,
}) {
  const letters = [...answer];
  const hint = letters
    .map((letter, index) =>
      revealIndices.includes(index) ? letter : "*"
    )
    .join(" ");

  // The field stays inline with the sentence and grows with the answer length.
  const inputWidth = Math.max(letters.length + 1, hint.length * 0.75);

  return (
    <input
      className="word-gap"
      type="text"
      value={value}
      placeholder={hint}
      onChange={(event) => onChange(event.target.value)}
      style={{ width: `${inputWidth}ch` }}
      aria-label="Введите пропущенное английское слово"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      disabled={disabled}
    />
  );
}
