import { initialSentences } from "../data/initialSentences";

const STORAGE_KEY = "english-word-trainer.sentences.v1";

export function loadSentences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error("Could not load saved sentences:", error);
  }

  return initialSentences;
}

export function saveSentences(sentences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sentences));
  } catch (error) {
    console.error("Could not save sentences:", error);
  }
}
