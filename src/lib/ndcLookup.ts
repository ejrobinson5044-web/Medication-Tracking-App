import { getNdcCandidates, ndcDigits } from './ndc';

interface OpenFdaNdcResult {
  generic_name?: string;
  brand_name?: string;
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

async function fetchByField(field: 'packaging.package_ndc' | 'product_ndc', value: string): Promise<OpenFdaNdcResult[]> {
  const res = await fetch(
    `https://api.fda.gov/drug/ndc.json?search=${field}:"${encodeURIComponent(value)}"&limit=10`,
  );
  if (!res.ok) return [];
  const data: OpenFdaNdcResponse = await res.json();
  return data.results ?? [];
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
    const seen = new Set<string>();

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
        if (!looked) continue;

        const dedupeKey = `${looked.ndc}|${looked.name}|${looked.brandOrCommonName ?? ''}|${looked.amount ?? ''}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          matches.push(looked);
        }
      }
    }

    cache.set(cacheKey, matches);
    return matches;
  } catch {
    cache.set(cacheKey, []);
    return [];
  }
}

export async function lookupNdc(ndc: string): Promise<NdcLookupResult | null> {
  const candidates = await lookupNdcCandidates(ndc);
  return candidates[0] ?? null;
}
