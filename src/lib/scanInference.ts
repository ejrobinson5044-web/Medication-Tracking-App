import type { MedicationInput, TimeOfDay } from './types';
import { ndcDigits, normalizeNdcOcr } from './ndc';

export type InferredFieldName = keyof Pick<MedicationInput, 'name' | 'brandOrCommonName' | 'ndc' | 'rxNumber' | 'amount' | 'frequency' | 'timesOfDay'>;

export interface InferredField<T = string | TimeOfDay[]> {
  value: T;
  confidence: number;
  evidence: string[];
}

export interface ScanInferenceResult {
  fields: Partial<Record<InferredFieldName, InferredField>>;
  warnings: string[];
}

const DOSE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?|tablet|tablets|tab|tabs|capsule|capsules|cap|caps)\b/i;
const NDC_LABELED_PATTERN = /\bN[D0O][C0O][:\s#-]*([\dOIlLSsBbQ][\dOIlLSsBbQ\s-]{8,15}[\dOIlLSsBbQ])\b/i;
const RX_LABELED_PATTERN = /\b(?:R\s?X|℞|PRESCRIPTION)\s*(?:#|NO\.?|NUMBER|NUM)?\s*[:#-]?\s*([\dOIlLSsBbQ][\dOIlLSsBbQ\s-]{3,15}[\dOIlLSsBbQ])\b/i;

const DIRECTIONS_PATTERNS = [
  /take\s+.+/i,
  /use\s+.+/i,
  /inject\s+.+/i,
  /inhale\s+.+/i,
  /apply\s+.+/i,
  /place\s+.+/i,
  /dissolve\s+.+/i,
];

const NON_NAME_LINE = /\b(rx|ndc|qty|quantity|refill|discard|expires?|prescriber|pharmacy|take|directions|sig|patient|dob|filled|use|inject|apply|inhale|tablet|capsule|mg|mcg|ml|units?)\b/i;
const MED_NAME_PATTERN = /\b([A-Z][A-Za-z-]{3,}(?:\s+[A-Z][A-Za-z-]{2,}){0,3})\b/;

function normalizeText(text: string): string {
  return normalizeNdcOcr(text).replace(/[—–]/g, '-');
}

function cleanedLines(text: string): string[] {
  return text
    .split(/\r?\n|\s{3,}/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

function addField<T extends string | TimeOfDay[]>(
  fields: ScanInferenceResult['fields'],
  key: InferredFieldName,
  value: T | null | undefined,
  confidence: number,
  evidence: string,
): void {
  if (value == null) return;
  if (typeof value === 'string' && value.trim().length === 0) return;
  if (Array.isArray(value) && value.length === 0) return;

  const existing = fields[key];
  if (!existing || confidence > existing.confidence) {
    fields[key] = { value, confidence, evidence: [evidence] } as InferredField;
  } else if (existing && existing.value === value) {
    existing.confidence = Math.min(100, existing.confidence + 4);
    existing.evidence.push(evidence);
  }
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
    .replace(/\bEr\b/g, 'ER')
    .replace(/\bXr\b/g, 'XR')
    .replace(/\bDr\b/g, 'DR');
}

function inferTimesAndFrequency(text: string): { frequency: string; timesOfDay: TimeOfDay[]; confidence: number; evidence: string } | null {
  const lower = text.toLowerCase();
  if (/as needed|\bprn\b/.test(lower)) return { frequency: 'As needed', timesOfDay: ['asNeeded'], confidence: 95, evidence: 'Found PRN/as-needed instructions' };
  if (/bedtime|nightly|before bed|\bhs\b/.test(lower)) return { frequency: 'At bedtime', timesOfDay: ['bedtime'], confidence: 92, evidence: 'Found bedtime/nightly instructions' };
  if (/twice|\bbid\b|2\s*(x|times)/.test(lower)) return { frequency: 'Twice daily', timesOfDay: ['morning', 'evening'], confidence: 90, evidence: 'Found twice-daily instructions' };
  if (/three|\btid\b|3\s*(x|times)/.test(lower)) return { frequency: 'Three times daily', timesOfDay: ['morning', 'noon', 'evening'], confidence: 90, evidence: 'Found three-times-daily instructions' };
  if (/four|\bqid\b|4\s*(x|times)/.test(lower)) return { frequency: 'Four times daily', timesOfDay: ['morning', 'noon', 'evening', 'bedtime'], confidence: 90, evidence: 'Found four-times-daily instructions' };
  if (/morning|breakfast|\bam\b|a\.m\./.test(lower)) return { frequency: 'Once daily', timesOfDay: ['morning'], confidence: 84, evidence: 'Found morning timing words' };
  if (/evening|dinner|supper|\bpm\b|p\.m\./.test(lower)) return { frequency: 'Once daily', timesOfDay: ['evening'], confidence: 84, evidence: 'Found evening timing words' };
  if (/daily|once|\bqd\b|every day/.test(lower)) return { frequency: 'Once daily', timesOfDay: ['morning'], confidence: 78, evidence: 'Found once-daily instructions' };
  const everyHours = lower.match(/every\s+(\d+)\s+hours?|q(\d+)h/);
  if (everyHours) return { frequency: `Every ${everyHours[1] ?? everyHours[2]} hours`, timesOfDay: [], confidence: 82, evidence: 'Found every-hours instructions' };
  return null;
}

function inferName(lines: string[]): { value: string; confidence: number; evidence: string } | null {
  const candidates = lines
    .filter((line) => line.length >= 4 && line.length <= 70)
    .filter((line) => !NON_NAME_LINE.test(line))
    .filter((line) => /[A-Za-z]/.test(line))
    .map((line) => line.match(MED_NAME_PATTERN)?.[1] ?? line)
    .filter((line) => line.split(/\s+/).some((part) => part.length >= 4));

  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => b.length - a.length)[0];
  return { value: titleCase(best), confidence: 62, evidence: 'Best medication-name-like line from OCR' };
}

export function inferMedicationFromScanText(textParts: string[]): ScanInferenceResult {
  const rawText = textParts.filter(Boolean).join('\n');
  const normalized = normalizeText(rawText);
  const lines = cleanedLines(normalized);
  const fields: ScanInferenceResult['fields'] = {};
  const warnings: string[] = [];

  const ndcMatch = normalized.match(NDC_LABELED_PATTERN);
  if (ndcMatch) {
    addField(fields, 'ndc', normalizeNdcOcr(ndcMatch[1]).replace(/\s+/g, '-'), 96, 'Number was printed next to NDC label');
  } else {
    const looseNdc = normalized.match(/\b[\d\s-]{10,16}\b/);
    if (looseNdc && [10, 11].includes(ndcDigits(looseNdc[0]).length)) addField(fields, 'ndc', looseNdc[0].trim(), 68, 'Found unlabeled 10/11-digit NDC-like number');
  }

  const rxMatch = normalized.match(RX_LABELED_PATTERN);
  if (rxMatch) {
    addField(fields, 'rxNumber', ndcDigits(rxMatch[1]), 94, 'Number was printed next to Rx label');
  }

  const doseMatch = normalized.match(DOSE_PATTERN);
  if (doseMatch) addField(fields, 'amount', doseMatch[0].replace(/\s+/, ' ').trim(), 86, 'Found dose/strength pattern');

  const directionsLine = lines.find((line) => DIRECTIONS_PATTERNS.some((pattern) => pattern.test(line)));
  const frequencySource = directionsLine ?? normalized;
  const timing = inferTimesAndFrequency(frequencySource);
  if (timing) {
    addField(fields, 'frequency', timing.frequency, timing.confidence, timing.evidence);
    addField(fields, 'timesOfDay', timing.timesOfDay, timing.confidence, timing.evidence);
  }

  const name = inferName(lines);
  if (name) addField(fields, 'name', name.value, name.confidence, name.evidence);

  if (!fields.ndc && !fields.rxNumber && !fields.name && !fields.amount) warnings.push('Low information scan: no NDC, Rx number, medication name, or dose was confidently detected.');
  if (fields.name && fields.name.confidence < 75) warnings.push('Medication name was inferred from OCR only. Verify it before saving.');
  if (fields.ndc && fields.ndc.confidence < 80) warnings.push('NDC was not printed next to a clear NDC label. Verify before saving.');

  return { fields, warnings };
}

export function evidenceSummary(result: ScanInferenceResult): string {
  const parts = Object.entries(result.fields).map(([key, field]) => `${key}: ${field.confidence}%`);
  return parts.length ? `Scan confidence — ${parts.join(', ')}.` : 'No confident scan fields found.';
}
