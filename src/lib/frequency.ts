import type { TimeOfDay } from './types';

const NUMBER_WORDS: Record<string, number> = {
  once: 1,
  one: 1,
  twice: 2,
  two: 2,
  three: 3,
  thrice: 3,
  four: 4,
};

function parseTimesPerDay(text: string): number | null {
  const lower = text.toLowerCase();

  const digitMatch = lower.match(/(\d+)\s*x\s*(a\s*)?day|(\d+)\s*times?\s*(a\s*|per\s*)?day/);
  if (digitMatch) {
    const n = Number(digitMatch[1] ?? digitMatch[3]);
    if (n > 0) return n;
  }

  const wordMatch = lower.match(/(once|twice|one|two|three|thrice|four)\s*(times?\s*)?(a\s*|per\s*)?day/);
  if (wordMatch) {
    return NUMBER_WORDS[wordMatch[1]] ?? null;
  }

  if (/\bdaily\b/.test(lower) && !/(every other|every \d|weekly|monthly)/.test(lower)) {
    return 1;
  }

  return null;
}

/**
 * Suggests which times of day to take a medication based on free-text
 * frequency, biased toward the user's preferred rhythm: morning first,
 * afternoon only if a third dose is needed, bedtime for the last dose.
 */
export function suggestTimesOfDay(frequency: string): TimeOfDay[] {
  const lower = frequency.toLowerCase();

  if (/bedtime|before bed|at night|nightly|night time/.test(lower)) {
    return ['bedtime'];
  }
  if (/(every )?morning\b/.test(lower) && !parseTimesPerDay(lower)) {
    return ['morning'];
  }

  const timesPerDay = parseTimesPerDay(lower);
  switch (timesPerDay) {
    case 1:
      return ['morning'];
    case 2:
      return ['morning', 'bedtime'];
    case 3:
      return ['morning', 'noon', 'bedtime'];
    case 4:
      return ['morning', 'noon', 'evening', 'bedtime'];
    default:
      return [];
  }
}
