import { recognize } from 'tesseract.js';
import { normalizeNdcOcr } from './ndc';
import type { MedicationInput } from './types';

export interface OcrResult {
  text: string;
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

// The Rx# itself is read via the manual highlight-and-crop flow
// (RxHighlightPicker), since that's far more accurate than guessing at it
// from the whole photo. This pass only needs the full-label text for the
// patterns that match reliably anywhere on the label: dose and frequency.
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

function normalizeOcrNdcCandidate(group: string): string {
  return normalizeNdcOcr(group).replace(/\s+/g, '-');
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
 * Pulls the NDC, dose, and frequency out of the label text via plain regex
 * — all of these read reliably anywhere on a label. We deliberately do NOT
 * guess the drug name from OCR here — on real pharmacy labels the
 * patient's own name is often the largest, highest-confidence line, which
 * made font-size-based name guessing confidently wrong. The Rx# is read
 * separately via the manual highlight-and-crop flow, since it's not
 * reliably formatted/labeled enough to regex-match like the NDC is.
 */
export function parseLabelText({ text }: OcrResult): Partial<MedicationInput> & { ndc?: string } {
  const result: Partial<MedicationInput> & { ndc?: string } = {};

  const ndcMatch = text.match(NDC_LABELED_PATTERN) ?? text.match(NDC_SHAPE_PATTERN);
  if (ndcMatch) {
    result.ndc = normalizeOcrNdcCandidate(ndcMatch[1]);
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
