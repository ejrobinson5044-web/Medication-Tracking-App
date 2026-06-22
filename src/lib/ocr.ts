import { recognize } from 'tesseract.js';
import type { MedicationInput } from './types';

export interface OcrLine {
  text: string;
  confidence: number;
  height: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

export async function recognizeLabelText(image: Blob): Promise<OcrResult> {
  const result = await recognize(image, 'eng');
  const lines: OcrLine[] = result.data.lines.map((line) => ({
    text: line.text.trim(),
    confidence: line.confidence,
    height: line.bbox.y1 - line.bbox.y0,
  }));
  return { text: result.data.text, lines };
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
  'pharmacist',
  'generic',
  'for',
  'street',
  'ave',
  'blvd',
];

const DOSE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?)\b/i;

// Pharmacy labels print the Rx/prescription number in formats like
// "Rx# 1234567", "RX: 1234567", "Rx No. 1234567" — it's printed cleanly and
// consistently across refills, making it a far more reliable identifier
// than guessing the drug name from font size each scan.
const RX_NUMBER_PATTERN = /\bRx\.?\s*(?:#|No\.?|number)?\s*[:#]?\s*(\d{5,9})\b/i;

// Common prescription "sig" abbreviations alongside plain-English phrasing.
const FREQUENCY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /every\s+other\s+day|q\.?o\.?d\.?\b/i, label: 'Every other day' },
  { pattern: /every\s+(\d+)\s+hours?|q(\d+)h\b/i, label: 'match-hours' },
  { pattern: /once\s+(a|per)?\s*day|once\s+daily|every\s+day\b|q\.?d\.?\b|q\.?\s?a\.?m\.?\b/i, label: 'Once daily' },
  {
    pattern: /twice\s+(a|per)?\s*day|twice\s+daily|two\s+times\s+(a|per)?\s*day|b\.?i\.?d\.?\b/i,
    label: 'Twice daily',
  },
  {
    pattern: /three\s+times\s+(a|per)?\s*day|3\s*x\s*(a|per)?\s*day|t\.?i\.?d\.?\b/i,
    label: 'Three times daily',
  },
  { pattern: /four\s+times\s+(a|per)?\s*day|4\s*x\s*(a|per)?\s*day|q\.?i\.?d\.?\b/i, label: 'Four times daily' },
  { pattern: /at\s+bedtime|before\s+bed|nightly|h\.?s\.?\b/i, label: 'At bedtime' },
  { pattern: /as\s+needed|p\.?r\.?n\.?\b/i, label: 'As needed' },
];

function cleanWord(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/[^a-zA-Z0-9\s'-]/g, '')
    .trim();
}

function isPlausibleName(text: string): boolean {
  if (text.length < 3 || text.length > 40) return false;
  const lower = text.toLowerCase();
  if (STOPWORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return false;
  if (DOSE_PATTERN.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (!/[a-zA-Z]{3,}/.test(text)) return false;
  // Sig lines ("TAKE ONE TABLET BY MOUTH...") are instructions, not the drug name.
  if (/^(take|use|apply|inject|instill)\b/i.test(text)) return false;
  return true;
}

/**
 * Picks the most likely drug name by scoring each candidate line on font
 * size (bigger text on a label is usually the drug name) and OCR
 * confidence, rather than just taking the first plausible line.
 */
function pickNameLine(lines: OcrLine[]): string | null {
  const candidates = lines
    .map((l) => ({ ...l, text: cleanWord(l.text) }))
    .filter((l) => isPlausibleName(l.text) && l.confidence >= 40);

  if (candidates.length === 0) return null;

  const maxHeight = Math.max(...candidates.map((l) => l.height));
  const scored = candidates.map((l) => ({
    line: l,
    score: l.height / maxHeight + l.confidence / 100,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].line.text;
}

export function parseLabelText({ text, lines }: OcrResult): Partial<MedicationInput> & { rxNumber?: string } {
  const result: Partial<MedicationInput> & { rxNumber?: string } = {};

  const rxMatch = text.match(RX_NUMBER_PATTERN);
  if (rxMatch) {
    result.rxNumber = rxMatch[1];
  }

  const doseMatch = text.match(DOSE_PATTERN);
  if (doseMatch) {
    result.amount = doseMatch[0].replace(/\s+/, ' ').trim();
  }

  for (const { pattern, label } of FREQUENCY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (label === 'match-hours') {
        result.frequency = `Every ${match[1] ?? match[2]} hours`;
      } else {
        result.frequency = label;
      }
      break;
    }
  }

  const name = pickNameLine(lines);
  if (name) {
    result.name = name;
  }

  return result;
}
