import { recognize } from 'tesseract.js';
import { ndcDigits, normalizeNdcOcr } from './ndc';
import type { MedicationInput } from './types';

export interface OcrResult {
  text: string;
}

export interface ParsedLabelText extends Partial<MedicationInput> {
  ndc?: string;
  rxNumber?: string;
}

const MAX_DIMENSION = 1600;

// Phone camera photos are often 8-12+ megapixels, which can make Tesseract
// take a very long time (or stall) on-device. Dose/frequency text is large
// and legible even downscaled, so shrinking first keeps this background
// pass fast and reliable.
async function downscale(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load image'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return blob;

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
    return resized ?? blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The Rx# itself is also supported by the manual highlight-and-crop flow
// (RxHighlightPicker), since that's far more accurate than guessing at it
// from the whole photo. This full-label pass still tries labeled Rx/NDC
// patterns first when the printed words are visible.
export async function recognizeLabelText(image: Blob): Promise<OcrResult> {
  const target = await downscale(image).catch(() => image);
  const result = await recognize(target, 'eng');
  return { text: result.data.text };
}

const DOSE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?)\b/i;

// The NDC (National Drug Code) is a standardized, publicly-lookupable
// identifier — unlike the Rx#, which is pharmacy-internal. Printed NDCs may
// have dashes, spaces, or no separators at all. OCR can also confuse tiny
// NDC print with look-alike letters (O/0, I or l/1, S/5, B/8), so keep the
// candidate broad here and let the lookup layer validate legal segmentations.
const NDC_LABELED_PATTERN = /\bN[D0O][C0O][:\s#-]*([\dOIlLSsBbQ][\dOIlLSsBbQ\s-]{8,15}[\dOIlLSsBbQ])\b/i;
const NDC_SHAPE_PATTERN = /\b([\dOIlLSsBbQ]{4,6}[-\s]?[\dOIlLSsBbQ]{3,4}[-\s]?[\dOIlLSsBbQ]{1,2})\b/;
const RX_LABELED_PATTERN = /\b(?:R\s?X|℞|PRESCRIPTION)\s*(?:#|NO\.?|NUMBER|NUM)?\s*[:#-]?\s*([\dOIlLSsBbQ][\dOIlLSsBbQ\s-]{3,15}[\dOIlLSsBbQ])\b/i;

function normalizeOcrNumberCandidate(group: string): string {
  return normalizeNdcOcr(group).replace(/\s+/g, '-');
}

function normalizeRxCandidate(group: string): string {
  return ndcDigits(normalizeNdcOcr(group));
}

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
 * Pulls the NDC, Rx number, dose, and frequency out of the label text via
 * plain regex. Labeled patterns are preferred so a visible "Rx" or "NDC"
 * tells the app which field the scanned number belongs to.
 */
export function parseLabelText({ text }: OcrResult): ParsedLabelText {
  const result: ParsedLabelText = {};

  const ndcMatch = text.match(NDC_LABELED_PATTERN) ?? text.match(NDC_SHAPE_PATTERN);
  if (ndcMatch) {
    result.ndc = normalizeOcrNumberCandidate(ndcMatch[1]);
  }

  const rxMatch = text.match(RX_LABELED_PATTERN);
  if (rxMatch) {
    const rxNumber = normalizeRxCandidate(rxMatch[1]);
    if (rxNumber.length >= 4) result.rxNumber = rxNumber;
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
