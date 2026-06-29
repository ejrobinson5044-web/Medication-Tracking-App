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

interface RxNormApproximateResponse {
  approximateGroup?: {
    candidate?: Array<{
      name?: string;
      score?: string;
      rank?: string;
      source?: string;
    }>;
  };
}

const cache = new Map<string, string[]>();

function addCleanName(names: Set<string>, value?: string): void {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (cleaned && cleaned.length > 1) names.add(cleaned);
}

async function searchApproximate(term: string): Promise<string[]> {
  const res = await fetch(
    `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=12&option=1`,
  );
  if (!res.ok) return [];
  const data: RxNormApproximateResponse = await res.json();
  const names = new Set<string>();

  for (const candidate of data.approximateGroup?.candidate ?? []) {
    addCleanName(names, candidate.name);
  }

  return Array.from(names);
}

async function searchDrugs(term: string): Promise<string[]> {
  const res = await fetch(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(term)}`);
  if (!res.ok) return [];
  const data: RxNormResponse = await res.json();

  const names = new Set<string>();
  for (const group of data.drugGroup?.conceptGroup ?? []) {
    for (const prop of group.conceptProperties ?? []) {
      addCleanName(names, prop.name);
    }
  }

  return Array.from(names);
}

/**
 * Looks up candidate medication names from RxNorm (NIH's free, public drug
 * name database) for autocomplete. It tries approximate matching first so
 * partial names and mild misspellings still produce suggestions, then falls
 * back to RxNorm's broader drug display-name endpoint.
 */
export async function searchDrugNames(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cacheKey = trimmed.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const names = new Set<string>();
    for (const name of await searchApproximate(trimmed)) addCleanName(names, name);
    for (const name of await searchDrugs(trimmed)) addCleanName(names, name);

    const lower = trimmed.toLowerCase();
    const results = Array.from(names)
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(lower) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(lower) ? 0 : 1;
        return aStarts - bStarts || a.length - b.length || a.localeCompare(b);
      })
      .slice(0, 12);

    cache.set(cacheKey, results);
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
