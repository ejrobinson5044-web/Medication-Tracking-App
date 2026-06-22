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
