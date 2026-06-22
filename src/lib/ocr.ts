import { recognize } from 'tesseract.js';
import type { MedicationInput } from './types';

export interface OcrResult {
  text: string;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

// Pharmacies almost universally highlight the Rx# on the sticker in
// highlighter yellow: strong red+green, much weaker blue, and not washed
// out toward white or gray.
function isHighlightYellow(r: number, g: number, b: number): boolean {
  return r > 170 && g > 150 && b < 150 && r - b > 40 && g - b > 30;
}

/**
 * Scans the photo for a highlighter-yellow patch and crops + upscales just
 * that region. Running OCR on this tight, enlarged crop instead of the
 * whole label dramatically improves Rx# read accuracy, since that's where
 * pharmacies mark the one number that's reliable across refills.
 */
async function cropToHighlight(blob: Blob): Promise<Blob | null> {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
  ctx.drawImage(img, 0, 0);

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  const step = 4;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (isHighlightYellow(data[i], data[i + 1], data[i + 2])) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;

  const pad = 24;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width - cropX, maxX - minX + pad * 2);
  const cropH = Math.min(height - cropY, maxY - minY + pad * 2);
  if (cropW < 12 || cropH < 12) return null;

  const scale = 3;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = cropW * scale;
  outCanvas.height = cropH * scale;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;
  outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, outCanvas.width, outCanvas.height);

  return new Promise((resolve) => outCanvas.toBlob((b) => resolve(b), 'image/png'));
}

export async function recognizeLabelText(image: Blob): Promise<OcrResult> {
  const highlight = await cropToHighlight(image).catch(() => null);
  const targets = highlight ? [highlight, image] : [image];

  const texts: string[] = [];
  for (const target of targets) {
    const result = await recognize(target, 'eng');
    texts.push(result.data.text);
  }
  // The highlighted crop's text comes first so its Rx# match wins if the
  // full label also contains other digit strings that could be confused
  // for it (NDC codes, phone numbers, refill counts, etc).
  return { text: texts.join('\n') };
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
