# Learning and Spaced-Repetition Specification

**Status:** Product requirement / source of truth for learning logic  
**Applies to:** English Word Trainer  
**Last updated:** 2026-11-07

This document defines how a vocabulary item moves through practice, review, and mastered states. If the implementation behaves differently, treat this document as the expected behavior and fix the code.

## 1. Core principles

1. Learning progress belongs to a **unique vocabulary word**, not to an individual sentence card.
2. A word answered correctly on its first completed attempt is mastered immediately.
3. If the first answer is incorrect, or the learner indicates that they do not know the word, the word enters spaced repetition.
4. A word in spaced repetition becomes mastered only after passing all six scheduled reviews.
5. A mastered word is permanently excluded from ordinary study and review. It must not appear again in the normal training flow.
6. Progress and review scheduling must survive page reloads and browser restarts.

## 2. Word identity

- The progress key is the normalized target word, not the sentence/card ID.
- Normalize by trimming surrounding whitespace and converting to lowercase.
- The same target word used in multiple sentences represents one vocabulary item and shares one learning state.
- Do not count duplicate sentence cards as additional vocabulary words.
- The current MVP uses single-word answers. If multi-word vocabulary is introduced later, normalization and input validation must be extended deliberately.

## 3. States

Each unique word has exactly one learning state:

- **NEW** — never answered incorrectly and not yet mastered.
- **REVIEW** — has made an error and is working through the review intervals.
- **MASTERED** — answered correctly on the first attempt, or passed all six reviews.

A mastered word is terminal in the normal learning algorithm. There is no automatic demotion or scheduled resurfacing.

Suggested per-word persisted data:

```js
{
  status: "NEW" | "REVIEW" | "MASTERED",
  reviewStage: 0,              // 0..5 while in REVIEW
  dueAfterOtherCards: 0,       // remaining other completed cards before it is due
  // optional diagnostic metadata:
  firstFailedAt: null,
  masteredAt: null
}
```

The exact implementation shape may differ, but it must preserve the same information and behavior.

## 4. First attempt

- A first attempt is evaluated when the learner completes/submits an answer for the word.
- Merely typing and correcting letters before submitting a complete answer is not an error.
- If the completed answer is correct and no incorrect completed attempt has occurred:
  - set status to `MASTERED`;
  - remove the word from all future ordinary study and review queues;
  - update the learned-word count and overall progress immediately.
- If the completed answer is incorrect, or the learner chooses an explicit “I don't know / reveal answer” action:
  - set status to `REVIEW`;
  - set `reviewStage = 0`;
  - schedule the first review after **5 other completed cards**.

## 5. Review schedule

A word that entered REVIEW must pass these six reviews in order:

| Review | Other completed cards to wait before showing it |
|---:|---:|
| 1 | 5 |
| 2 | 10 |
| 3 | 20 |
| 4 | 40 |
| 5 | 80 |
| 6 | 160 |

Rules:

- The interval is measured in **other completed cards**, not elapsed time.
- The target word's own display/answer does not count toward its interval.
- While waiting, the learner continues with other eligible words.
- When the remaining counter reaches zero, the word becomes eligible for the next review.
- A correct answer at a review advances to the next stage and schedules the next interval.
- A correct answer at Review 6 changes the state to MASTERED immediately.
- An incorrect completed answer at **any** review resets the word to Review 1: set `reviewStage = 0` and schedule it again after 5 other completed cards.
- An explicit “I don't know / reveal answer” action has the same effect as an incorrect answer.

## 6. Counting cards and selecting the next card

- Increment the review countdown after each completed card for a **different** vocabulary word.
- A word must never count its own display or answer as one of the cards it was waiting for.
- Other review cards count as completed cards for countdown purposes, provided they are different words.
- A word becomes due after the specified number of other cards have been completed. For example, after a failure, five other words must be completed before that word can appear again.
- Do not show a due word before its countdown reaches zero.
- If multiple words are due, show the one with the earliest due point; use a stable deterministic tie-breaker (for example, the order in which they became due).
- If no review is due, continue with NEW words.
- Never select MASTERED words.
- If no eligible NEW word or due REVIEW word exists, show a clear “No cards currently due” / completed-session state rather than silently repeating a mastered word or violating an interval.
- If the vocabulary is too small to fill an interval, do not shorten the interval. Explain that the learner needs more available words, or wait until more eligible cards exist.

## 7. Progress display

The overall progress bar is based on unique vocabulary words:

`mastered unique words / total unique words in the vocabulary`

Display at least:
- mastered count;
- total unique word count;
- percentage, rounded to a whole number for display;
- a visual progress bar with the same percentage.

Words in REVIEW are not mastered and do not contribute to the numerator. Do not hardcode a future goal such as 4,000 as the denominator unless a separate explicit product requirement says the denominator is a fixed target. By default, use the unique words actually present in the active vocabulary.

## 8. Persistence and data integrity

- Persist word states and review countdowns across reloads and browser restarts.
- Keep learning progress separate from sentence content/admin edits where practical.
- Use a versioned storage key/schema so future migrations can be implemented safely.
- Updating or deleting a sentence must not accidentally erase a word's progress if that word still exists in another sentence.
- If a word is removed from the vocabulary entirely, its progress may be retained as orphaned data or cleaned up deliberately; it must not corrupt other words.
- Do not reset a user's progress merely because sentence order changes or new sentences are added.
- The current MVP uses browser localStorage. A future backend must preserve the same per-user, per-word state and scheduling semantics.

## 9. Acceptance tests

The implementation is correct only if all of the following pass:

1. Correct first completed answer -> word becomes MASTERED immediately and never appears again in normal training.
2. Incorrect first completed answer -> word is scheduled after exactly 5 other completed cards.
3. Correct Review 1 -> next review is after exactly 10 other completed cards.
4. Subsequent correct reviews schedule 20, 40, 80, then 160 other completed cards.
5. Correct Review 6 -> word becomes MASTERED and is excluded permanently from normal training.
6. An incorrect answer at any review -> schedule resets to 5 other completed cards.
7. “I don't know / reveal answer” on the first attempt or a review -> same failure/reset behavior.
8. The target word itself never reduces its own countdown.
9. Other review words count as other completed cards.
10. Duplicate sentence cards containing the same normalized target word share one state and count once in progress.
11. MASTERED words never appear in the normal study queue.
12. Reloading or restarting the browser preserves status, stage, and remaining countdown.
13. The progress numerator and denominator count unique words, not sentence cards.
14. If no card is eligible, the app does not break the interval rules by showing a mastered or not-yet-due word.

## 10. Explicit non-goals

- No automatic review of MASTERED words in ordinary training.
- No calendar-based intervals; intervals are measured in completed cards.
- No automatic forgetting/demotion of mastered words.
- No fixed 4,000-word progress denominator unless separately requested.
