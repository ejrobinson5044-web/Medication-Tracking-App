export function ndcDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeNdcOcr(value: string): string {
  return value
    .replace(/[OoQ]/g, '0')
    .replace(/[IilL]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8');
}

function addDashedNdc(candidates: Set<string>, segments: string[]): void {
  if (segments.every(Boolean)) {
    candidates.add(segments.join('-'));
  }
}

/**
 * NDCs are printed in 10-digit FDA formats with variable segment lengths:
 * 4-4-2, 5-3-2, or 5-4-1. Pharmacy/billing systems may also store an
 * 11-digit 5-4-2 normalized form with an inserted leading zero in one
 * segment. When OCR or a user removes dashes, try every valid segmentation.
 */
export function getNdcCandidates(raw: string): string[] {
  const cleaned = normalizeNdcOcr(raw).trim();
  const digits = ndcDigits(cleaned);
  const candidates = new Set<string>();

  const dashed = cleaned.match(/(\d{4,6})\D+(\d{3,4})\D+(\d{1,2})/);
  if (dashed) {
    addDashedNdc(candidates, [dashed[1], dashed[2], dashed[3]]);
  }

  if (digits.length === 10) {
    addDashedNdc(candidates, [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 10)]); // 4-4-2
    addDashedNdc(candidates, [digits.slice(0, 5), digits.slice(5, 8), digits.slice(8, 10)]); // 5-3-2
    addDashedNdc(candidates, [digits.slice(0, 5), digits.slice(5, 9), digits.slice(9, 10)]); // 5-4-1
  }

  if (digits.length === 11) {
    addDashedNdc(candidates, [digits.slice(0, 5), digits.slice(5, 9), digits.slice(9, 11)]); // 5-4-2

    // Recover likely 10-digit FDA forms from 11-digit HIPAA/billing padding.
    if (digits[0] === '0') {
      addDashedNdc(candidates, [digits.slice(1, 5), digits.slice(5, 9), digits.slice(9, 11)]); // 4-4-2
    }
    if (digits[5] === '0') {
      addDashedNdc(candidates, [digits.slice(0, 5), digits.slice(6, 9), digits.slice(9, 11)]); // 5-3-2
    }
    if (digits[9] === '0') {
      addDashedNdc(candidates, [digits.slice(0, 5), digits.slice(5, 9), digits.slice(10, 11)]); // 5-4-1
    }
  }

  return [...candidates];
}
