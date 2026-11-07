import { useState } from "react";

const emptyForm = {
  russian: "",
  englishTemplate: "",
  word: "",
  revealPositions: "",
  level: "B1",
};

function createId() {
  return `sentence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function AdminPage({ sentences, onSave, onDelete }) {
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm({ ...emptyForm });
    setEditingId(null);
    setError("");
  }

  function handleEdit(sentence) {
    setEditingId(sentence.id);
    setForm({
      russian: sentence.russian,
      englishTemplate: sentence.englishTemplate,
      word: sentence.word,
      revealPositions: (sentence.revealIndices || []).map((index) => index + 1).join(", "),
      level: sentence.level || "B1",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const russian = form.russian.trim();
    const englishTemplate = form.englishTemplate.trim();
    const word = form.word.trim();

    if (!russian || !englishTemplate || !word) {
      setError("Заполни все обязательные поля.");
      return;
    }

    if (/\s/.test(word)) {
      setError("Для этой версии указывай одно слово без пробелов.");
      return;
    }

    const placeholderCount = (englishTemplate.match(/\{word\}/g) || []).length;
    if (placeholderCount !== 1) {
      setError("В английском шаблоне нужно ровно один раз указать {word}.");
      return;
    }

    const rawPositions = form.revealPositions.trim()
      ? form.revealPositions.split(",").map((value) => value.trim())
      : [];

    if (rawPositions.some((value) => value === "" || !/^\d+$/.test(value))) {
      setError("Укажи позиции открытых букв числами, например: 1, 3.");
      return;
    }

    const positions = rawPositions.map((value) => Number(value) - 1);
    const wordLength = [...word].length;
    if (positions.some((index) => index < 0 || index >= wordLength)) {
      setError(`Позиции букв должны быть от 1 до ${wordLength}.`);
      return;
    }

    onSave({
      id: editingId || createId(),
      russian,
      englishTemplate,
      word,
      revealIndices: [...new Set(positions)],
      level: form.level,
    });
    resetForm();
  }

  function handleDelete(sentence) {
    if (!window.confirm(`Удалить предложение «${sentence.russian}»?`)) return;
    onDelete(sentence.id);
    if (editingId === sentence.id) resetForm();
  }

  return (
    <section className="admin-layout">
      <div className="panel">
        <h2>{editingId ? "Редактировать предложение" : "Добавить предложение"}</h2>
        <p className="muted">
          В английском шаблоне поставь <code>{"{word}"}</code> вместо изучаемого слова.
        </p>

        <form className="admin-form" onSubmit={handleSubmit}>
          <label>
            Предложение на русском
            <textarea rows="2" value={form.russian} onChange={(event) => updateField("russian", event.target.value)} placeholder="Я оставил пальто в машине." required />
          </label>

          <label>
            Английский шаблон
            <input type="text" value={form.englishTemplate} onChange={(event) => updateField("englishTemplate", event.target.value)} placeholder="I left my {word} in the car." required />
          </label>

          <label>
            Пропущенное слово
            <input type="text" value={form.word} onChange={(event) => updateField("word", event.target.value)} placeholder="coat" required />
          </label>

          <label>
            Открытые буквы (позиции начиная с 1)
            <input type="text" value={form.revealPositions} onChange={(event) => updateField("revealPositions", event.target.value)} placeholder="Например: 3 или 1, 4" />
          </label>

          <label>
            Уровень
            <select value={form.level} onChange={(event) => updateField("level", event.target.value)}>
              <option value="A1">A1</option>
              <option value="A2">A2</option>
              <option value="B1">B1</option>
              <option value="B2">B2</option>
              <option value="C1">C1</option>
            </select>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="form-actions">
            <button className="button button-primary" type="submit">
              {editingId ? "Сохранить изменения" : "Добавить"}
            </button>
            {editingId && <button className="button button-secondary" type="button" onClick={resetForm}>Отмена</button>}
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Все предложения ({sentences.length})</h2>
        {sentences.length === 0 ? (
          <p className="muted">Предложений пока нет.</p>
        ) : (
          <div className="sentence-list">
            {sentences.map((sentence) => (
              <article className="sentence-item" key={sentence.id}>
                <div>
                  <p className="sentence-item-russian">{sentence.russian}</p>
                  <p className="sentence-item-english">{sentence.englishTemplate.replace("{word}", `[${sentence.word}]`)}</p>
                  <span className="muted">{sentence.level}</span>
                </div>
                <div className="sentence-item-actions">
                  <button className="button button-secondary" onClick={() => handleEdit(sentence)}>Изменить</button>
                  <button className="button button-danger" onClick={() => handleDelete(sentence)}>Удалить</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
