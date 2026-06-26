import type { MedicationInput, TimeOfDay } from './types';
import { ndcDigits, normalizeNdcOcr } from './ndc';

const DOSE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?|tablet|tablets|tab|tabs|capsule|capsules|cap|caps)\b/i;
const NDC_PATTERN = /\bN[D0O][C0O][:\s#-]*([\dOIlLSsBbQ][\dOIlLSsBbQ\s-]{8,15}[\dOIlLSsBbQ])\b/i;
const RX_PATTERN = /\b(?:R\s?X|℞|PRESCRIPTION)\s*(?:#|NO\.?|NUMBER|NUM)?\s*[:#-]?\s*([\dOIlLSsBbQ][\dOIlLSsBbQ\s-]{3,15}[\dOIlLSsBbQ])\b/i;

const COMMON_STOP_LINES = [
  /^(medication|medicine|drug|name|dose|sig|instructions|frequency|prescriber|pharmacy|active medications?)$/i,
  /^(allergies|problem list|patient|dob|date|page \d+)/i,
];

function timesFromFrequency(text: string): TimeOfDay[] {
  const lower = text.toLowerCase();
  if (/as needed|prn/.test(lower)) return ['asNeeded'];
  if (/bedtime|nightly|before bed|\bhs\b/.test(lower)) return ['bedtime'];
  if (/morning|breakfast|\bam\b|a\.m\./.test(lower)) return ['morning'];
  if (/noon|lunch|afternoon/.test(lower)) return ['noon'];
  if (/evening|dinner|supper|\bpm\b|p\.m\./.test(lower)) return ['evening'];
  if (/twice|bid|2\s*(x|times)/.test(lower)) return ['morning', 'evening'];
  if (/three|tid|3\s*(x|times)/.test(lower)) return ['morning', 'noon', 'evening'];
  if (/four|qid|4\s*(x|times)/.test(lower)) return ['morning', 'noon', 'evening', 'bedtime'];
  if (/daily|once|qd|every day/.test(lower)) return ['morning'];
  return [];
}

function frequencyFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/as needed|prn/.test(lower)) return 'As needed';
  if (/bedtime|nightly|before bed|\bhs\b/.test(lower)) return 'At bedtime';
  if (/twice|bid|2\s*(x|times)/.test(lower)) return 'Twice daily';
  if (/three|tid|3\s*(x|times)/.test(lower)) return 'Three times daily';
  if (/four|qid|4\s*(x|times)/.test(lower)) return 'Four times daily';
  const everyHours = lower.match(/every\s+(\d+)\s+hours?|q(\d+)h/);
  if (everyHours) return `Every ${everyHours[1] ?? everyHours[2]} hours`;
  if (/daily|once|qd|every day/.test(lower)) return 'Once daily';
  return '';
}

function cleanupName(raw: string): string {
  return raw
    .replace(NDC_PATTERN, ' ')
    .replace(RX_PATTERN, ' ')
    .replace(DOSE_PATTERN, ' ')
    .replace(/\b(take|by mouth|po|oral|tablet|capsule|daily|twice|three times|four times|once|every|as needed|prn).*$/i, ' ')
    .replace(/[•*|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNdcCandidate(value: string): string {
  return normalizeNdcOcr(value).replace(/\s+/g, '-');
}

function normalizeRxCandidate(value: string): string {
  return ndcDigits(normalizeNdcOcr(value));
}

function parseLine(line: string): MedicationInput | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 5) return null;
  if (COMMON_STOP_LINES.some((pattern) => pattern.test(trimmed))) return null;

  const doseMatch = trimmed.match(DOSE_PATTERN);
  const frequency = frequencyFromText(trimmed);
  const timesOfDay = timesFromFrequency(trimmed);
  const ndcMatch = trimmed.match(NDC_PATTERN);
  const rxMatch = trimmed.match(RX_PATTERN);
  const name = cleanupName(trimmed);

  if (!name || (!doseMatch && !frequency && !ndcMatch && !rxMatch)) return null;

  return {
    name,
    brandOrCommonName: '',
    ndc: ndcMatch ? normalizeNdcCandidate(ndcMatch[1]) : '',
    rxNumber: rxMatch ? normalizeRxCandidate(rxMatch[1]) : '',
    amount: doseMatch?.[0]?.trim() ?? 'Dose not found',
    frequency: frequency || 'Frequency not found',
    timesOfDay,
    notes: trimmed,
  };
}

export function parseMedicationListText(text: string): MedicationInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const meds: MedicationInput[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const joined = [lines[i], lines[i + 1], lines[i + 2]].filter(Boolean).join(' ');
    const parsed = parseLine(joined) ?? parseLine(lines[i]);
    if (!parsed) continue;

    const key = `${parsed.name.toLowerCase()}|${parsed.amount.toLowerCase()}|${parsed.frequency.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    meds.push(parsed);
  }

  return meds.slice(0, 30);
}
