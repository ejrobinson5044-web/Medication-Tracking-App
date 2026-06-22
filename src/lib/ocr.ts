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

const DOSE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?)\b/i;

// Pharmacy labels print the Rx/prescription number in formats like
// "Rx# 1234567", "RX: 1234567", "Rx No. 1234567", "Prescription #1234567"
// — it's printed cleanly and consistently across refills (the same Rx#
// reprints on every refill of the same prescription), which makes it a far
// more reliable identifier than guessing the drug name off the label, where
// the patient's own name is often the largest, highest-confidence text and
// gets mistaken for the drug name.
const RX_NUMBER_PATTERN = /\b(?:Rx|Prescription)\.?\s*(?:#|No\.?|number)?\s*[:#]?\s*(\d{5,10})\b/i;

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

/**
 * Pulls the Rx# and the patterns we can match reliably (dose, frequency)
 * straight out of the label text. We deliberately do NOT guess the drug
 * name from font size/line position anymore — on real pharmacy labels the
 * patient's own name is often the largest, highest-confidence line, which
 * made that heuristic confidently wrong. The Rx# is the one thing printed
 * consistently across refills, so it's the only reliable identifier; the
 * caller looks it up against previously-saved medications to fill in the
 * name, and otherwise leaves the name for the person to type once.
 */
export function parseLabelText({ text }: OcrResult): Partial<MedicationInput> & { rxNumber?: string } {
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

  return result;
}
