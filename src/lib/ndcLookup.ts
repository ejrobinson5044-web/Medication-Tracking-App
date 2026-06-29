import { getNdcCandidates, ndcDigits } from './ndc';

interface OpenFdaNdcResult {
  generic_name?: string;
  brand_name?: string;
  product_ndc?: string;
  packaging?: Array<{ package_ndc?: string }>;
  active_ingredients?: Array<{ name?: string; strength?: string }>;
}

interface OpenFdaNdcResponse {
  results?: OpenFdaNdcResult[];
}

export interface NdcLookupResult {
  ndc: string;
  name: string;
  brandOrCommonName?: string;
  amount?: string;
}

const cache = new Map<string, NdcLookupResult[]>();
const nameCache = new Map<string, NdcLookupResult[]>();

// openFDA reports strength as "<amount> <unit>/<denominator>" (e.g. "80 mg/1");
// the denominator is only meaningful for liquids/concentrations, so drop a
// trailing "/1" since that's just "per one [tablet/capsule/unit]".
function formatStrength(strength: string): string {
  return strength.replace(/\/1$/, '').trim();
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function quoteForOpenFda(value: string): string {
  return value.replace(/"/g, '').trim();
}

async function fetchByField(field: 'packaging.package_ndc' | 'product_ndc', value: string): Promise<OpenFdaNdcResult[]> {
  const res = await fetch(
    `https://api.fda.gov/drug/ndc.json?search=${field}:"${encodeURIComponent(value)}"&limit=10`,
  );
  if (!res.ok) return [];
  const data: OpenFdaNdcResponse = await res.json();
  return data.results ?? [];
}

async function fetchByNameField(field: 'generic_name' | 'brand_name' | 'active_ingredients.name', value: string): Promise<OpenFdaNdcResult[]> {
  const cleaned = quoteForOpenFda(value);
  if (!cleaned) return [];

  const res = await fetch(
    `https://api.fda.gov/drug/ndc.json?search=${field}:"${encodeURIComponent(cleaned)}"&limit=25`,
  );
  if (!res.ok) return [];
  const data: OpenFdaNdcResponse = await res.json();
  return data.results ?? [];
}

function bestNdcFromResult(result: OpenFdaNdcResult): string | null {
  return result.packaging?.find((pkg) => pkg.package_ndc)?.package_ndc ?? result.product_ndc ?? null;
}

function toLookupResult(ndc: string, result: OpenFdaNdcResult): NdcLookupResult | null {
  if (!result.generic_name) return null;

  const strength = result.active_ingredients?.[0]?.strength;
  return {
    ndc,
    name: titleCase(result.generic_name),
    brandOrCommonName:
      result.brand_name && result.brand_name.toLowerCase() !== result.generic_name.toLowerCase()
        ? titleCase(result.brand_name)
        : undefined,
    amount: strength ? formatStrength(strength) : undefined,
  };
}

function dedupeResults(results: NdcLookupResult[]): NdcLookupResult[] {
  const seen = new Set<string>();
  const deduped: NdcLookupResult[] = [];

  for (const result of results) {
    const key = `${result.ndc}|${result.name}|${result.brandOrCommonName ?? ''}|${result.amount ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }

  return deduped;
}

/**
 * The NDC (National Drug Code) is a real, standardized identifier — unlike
 * the pharmacy-internal Rx# — so openFDA's free public NDC directory can
 * resolve it straight to a drug name with no manual entry needed. Because
 * real labels and OCR may omit dashes, this tries every valid FDA/HIPAA dash
 * layout and returns every medication match instead of trusting one layout.
 */
export async function lookupNdcCandidates(rawNdc: string): Promise<NdcLookupResult[]> {
  const cacheKey = ndcDigits(rawNdc);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const ndcCandidates = getNdcCandidates(rawNdc);
    const matches: NdcLookupResult[] = [];

    for (const ndc of ndcCandidates) {
      // Labels print the full package NDC (e.g. 00074-3368-13); openFDA also
      // indexes the shorter product_ndc (the first two segments) in case the
      // package-level segment doesn't match.
      const segments = ndc.split('-');
      const productNdc = segments.length >= 2 ? segments.slice(0, 2).join('-') : ndc;

      const results = [
        ...(await fetchByField('packaging.package_ndc', ndc)),
        ...(await fetchByField('product_ndc', productNdc)),
      ];

      for (const result of results) {
        const looked = toLookupResult(ndc, result);
        if (looked) matches.push(looked);
      }
    }

    const deduped = dedupeResults(matches);
    cache.set(cacheKey, deduped);
    return deduped;
  } catch {
    cache.set(cacheKey, []);
    return [];
  }
}

/**
 * Resolves a selected medication name back to openFDA NDC candidates. RxNorm
 * suggestions do not carry NDCs, so this does a second public-directory lookup
 * by generic/brand/ingredient name after the user chooses a dropdown option.
 */
export async function lookupNdcCandidatesByName(name: string): Promise<NdcLookupResult[]> {
  const cacheKey = name.trim().toLowerCase();
  if (cacheKey.length < 2) return [];

  const cached = nameCache.get(cacheKey);
  if (cached) return cached;

  try {
    const results = [
      ...(await fetchByNameField('generic_name', name)),
      ...(await fetchByNameField('brand_name', name)),
      ...(await fetchByNameField('active_ingredients.name', name)),
    ];

    const mapped = results
      .map((result) => {
        const ndc = bestNdcFromResult(result);
        return ndc ? toLookupResult(ndc, result) : null;
      })
      .filter((result): result is NdcLookupResult => Boolean(result));

    const deduped = dedupeResults(mapped).slice(0, 12);
    nameCache.set(cacheKey, deduped);
    return deduped;
  } catch {
    nameCache.set(cacheKey, []);
    return [];
  }
}

export async function lookupNdc(ndc: string): Promise<NdcLookupResult | null> {
  const candidates = await lookupNdcCandidates(ndc);
  return candidates[0] ?? null;
}
