import { recognize } from 'tesseract.js';
import type { MedicationInput } from './types';

export async function recognizeLabelText(image: Blob): Promise<string> {
  const result = await recognize(image, 'eng');
  return result.data.text;
}

const STOPWORDS = [
  'pharmacy',
  'rx',
  'refill',
  'refills',
  'qty',
  'quantity',
  'discard',
  'after',
  'doctor',
  'dr',
  'prescriber',
  'patient',
  'date',
  'ndc',
  'mfg',
  'lot',
  'exp',
  'expires',
  'store',
  'tablet',
  'tablets',
  'capsule',
  'capsules',
  'warning',
  'caution',
];

const DOSE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?)\b/i;

const FREQUENCY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /once\s+(a|per)?\s*day|once\s+daily|every\s+day\b|q\.?d\.?\b/i, label: 'Once daily' },
  { pattern: /twice\s+(a|per)?\s*day|twice\s+daily|two\s+times\s+(a|per)?\s*day|b\.?i\.?d\.?\b/i, label: 'Twice daily' },
  {
    pattern: /three\s+times\s+(a|per)?\s*day|3\s*x\s*(a|per)?\s*day|t\.?i\.?d\.?\b/i,
    label: 'Three times daily',
  },
  { pattern: /four\s+times\s+(a|per)?\s*day|4\s*x\s*(a|per)?\s*day|q\.?i\.?d\.?\b/i, label: 'Four times daily' },
  { pattern: /at\s+bedtime|before\s+bed|nightly|h\.?s\.?\b/i, label: 'At bedtime' },
  { pattern: /every\s+(\d+)\s+hours?/i, label: 'match' },
  { pattern: /as\s+needed|p\.?r\.?n\.?\b/i, label: 'As needed' },
];

function isLikelyName(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 40) return false;
  const lower = trimmed.toLowerCase();
  if (STOPWORDS.some((w) => lower.includes(w))) return false;
  if (DOSE_PATTERN.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  return true;
}

export function parseLabelText(text: string): Partial<MedicationInput> {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const result: Partial<MedicationInput> = {};

  const doseMatch = text.match(DOSE_PATTERN);
  if (doseMatch) {
    result.amount = doseMatch[0].replace(/\s+/, ' ').trim();
  }

  for (const { pattern, label } of FREQUENCY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      result.frequency = label === 'match' ? `Every ${match[1]} hours` : label;
      break;
    }
  }

  const nameLine = lines.find(isLikelyName);
  if (nameLine) {
    result.name = nameLine
      .replace(/\s{2,}/g, ' ')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim();
  }

  return result;
}
