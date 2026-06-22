interface RxNormConceptProperty {
  name: string;
}

interface RxNormResponse {
  drugGroup?: {
    conceptGroup?: Array<{
      conceptProperties?: RxNormConceptProperty[];
    }>;
  };
}

const cache = new Map<string, string[]>();

/**
 * Looks up candidate medication names from RxNorm (NIH's free, public drug
 * name database) for autocomplete. Fails silently and returns no
 * suggestions if the network request doesn't succeed.
 */
export async function searchDrugNames(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cached = cache.get(trimmed.toLowerCase());
  if (cached) return cached;

  try {
    const res = await fetch(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(trimmed)}`);
    if (!res.ok) return [];
    const data: RxNormResponse = await res.json();

    const names = new Set<string>();
    for (const group of data.drugGroup?.conceptGroup ?? []) {
      for (const prop of group.conceptProperties ?? []) {
        names.add(prop.name);
      }
    }

    const results = Array.from(names).slice(0, 8);
    cache.set(trimmed.toLowerCase(), results);
    return results;
  } catch {
    return [];
  }
}

export interface ParsedDrugName {
  name: string;
  brandOrCommonName?: string;
  amount?: string;
}

const STRENGTH_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|%|unt|units?)\b/i;

/**
 * RxNorm's display names pack the generic name, strength, dosage form, and
 * (for branded concepts) the brand name into one string, e.g.
 * "lurasidone hydrochloride 60 MG Oral Tablet [Latuda]". Splits that back
 * into the separate fields the form actually has, so picking a suggestion
 * fills in name/brand/dose instead of dumping the raw string into Name.
 */
export function parseDrugDisplayName(raw: string): ParsedDrugName {
  let text = raw.trim();

  let brandOrCommonName: string | undefined;
  const bracketMatch = text.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    brandOrCommonName = bracketMatch[1].trim();
    text = text.slice(0, bracketMatch.index).trim();
  }

  let amount: string | undefined;
  const strengthMatch = text.match(STRENGTH_PATTERN);
  if (strengthMatch && strengthMatch.index !== undefined) {
    amount = strengthMatch[0].replace(/\s+/, ' ').trim();
    text = text.slice(0, strengthMatch.index).trim();
  }

  return { name: text || raw.trim(), brandOrCommonName, amount };
}
