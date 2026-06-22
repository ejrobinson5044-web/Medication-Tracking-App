interface OpenFdaNdcResult {
  generic_name?: string;
  brand_name?: string;
  active_ingredients?: Array<{ name?: string; strength?: string }>;
}

interface OpenFdaNdcResponse {
  results?: OpenFdaNdcResult[];
}

export interface NdcLookupResult {
  name: string;
  brandOrCommonName?: string;
  amount?: string;
}

const cache = new Map<string, NdcLookupResult | null>();

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

async function fetchByField(field: 'packaging.package_ndc' | 'product_ndc', value: string): Promise<OpenFdaNdcResult | null> {
  const res = await fetch(
    `https://api.fda.gov/drug/ndc.json?search=${field}:"${encodeURIComponent(value)}"&limit=1`,
  );
  if (!res.ok) return null;
  const data: OpenFdaNdcResponse = await res.json();
  return data.results?.[0] ?? null;
}

/**
 * The NDC (National Drug Code) is a real, standardized identifier — unlike
 * the pharmacy-internal Rx# — so openFDA's free public NDC directory can
 * resolve it straight to a drug name with no manual entry needed.
 */
export async function lookupNdc(ndc: string): Promise<NdcLookupResult | null> {
  const cached = cache.get(ndc);
  if (cached !== undefined) return cached;

  try {
    // Labels print the full package NDC (e.g. 00074-3368-13); openFDA also
    // indexes the shorter product_ndc (the first two segments) in case the
    // package-level segment doesn't match.
    const segments = ndc.split('-');
    const productNdc = segments.length >= 2 ? segments.slice(0, 2).join('-') : ndc;

    const result = (await fetchByField('packaging.package_ndc', ndc)) ?? (await fetchByField('product_ndc', productNdc));
    if (!result || !result.generic_name) {
      cache.set(ndc, null);
      return null;
    }

    const strength = result.active_ingredients?.[0]?.strength;
    const looked: NdcLookupResult = {
      name: titleCase(result.generic_name),
      brandOrCommonName: result.brand_name && result.brand_name.toLowerCase() !== result.generic_name.toLowerCase()
        ? titleCase(result.brand_name)
        : undefined,
      amount: strength ? formatStrength(strength) : undefined,
    };
    cache.set(ndc, looked);
    return looked;
  } catch {
    return null;
  }
}
