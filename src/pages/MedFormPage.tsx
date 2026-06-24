import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import { medicationsStore, rxLookupStore } from '../lib/db';
import { recognizeLabelText, parseLabelText } from '../lib/ocr';
import { lookupNdcCandidates, type NdcLookupResult } from '../lib/ndcLookup';
import { searchDrugNames, parseDrugDisplayName } from '../lib/drugSearch';
import { readBarcodeTexts } from '../lib/barcode';
import { ndcDigits, normalizeNdcOcr } from '../lib/ndc';
import RxHighlightPicker from '../components/RxHighlightPicker';
import {
  TIMES_OF_DAY,
  TIME_OF_DAY_LABELS,
  type Medication,
  type MedicationInput,
  type RxLookupEntry,
  type TimeOfDay,
} from '../lib/types';

type HighlightMode = 'rx' | 'ndc';

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Surfaces close matches (not just exact) since a hand-cropped OCR read of
 * a single digit string can easily be off by a digit or two. */
function findRxCandidates(digits: string, entries: RxLookupEntry[]): RxLookupEntry[] {
  return entries
    .map((entry) => ({ entry, distance: levenshtein(digits, entry.rxNumber) }))
    .filter(({ entry, distance }) => distance <= 2 || entry.rxNumber.includes(digits) || digits.includes(entry.rxNumber))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map(({ entry }) => entry);
}

function frequencyFromTimes(times: TimeOfDay[]): string {
  switch (times.length) {
    case 0:
      return '';
    case 1:
      return 'Once daily';
    case 2:
      return 'Twice daily';
    case 3:
      return 'Three times daily';
    case 4:
      return 'Four times daily';
    default:
      return `${times.length} times daily`;
  }
}

function extractLikelyNdcFromText(text: string): string | null {
  const normalized = normalizeNdcOcr(text);
  const candidates = normalized.match(/[\d\s-]{10,16}/g) ?? [];
  return (
    candidates.find((candidate) => {
      const length = ndcDigits(candidate).length;
      return length === 10 || length === 11;
    }) ?? null
  );
}

function extractLikelyRxFromText(text: string): string | null {
  const normalized = normalizeNdcOcr(text);
  const labeled = normalized.match(/\bR\s?X\s?#?[:\s-]*([\d\s-]{4,16})/i);
  if (labeled) return ndcDigits(labeled[1]);

  const candidates = normalized.match(/[\d\s-]{6,16}/g) ?? [];
  const digitGroups = candidates
    .map((candidate) => ndcDigits(candidate))
    .filter((candidate) => candidate.length >= 6)
    .sort((a, b) => b.length - a.length);
  return digitGroups[0] ?? null;
}

const emptyForm: MedicationInput = {
  name: '',
  brandOrCommonName: '',
  ndc: '',
  rxNumber: '',
  amount: '',
  frequency: '',
  timesOfDay: [],
  notes: '',
};

export default function MedFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<MedicationInput>(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [scanning, setScanning] = useState(false);
  const [ndcLooking, setNdcLooking] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode | null>(null);
  const [rxCandidates, setRxCandidates] = useState<RxLookupEntry[]>([]);
  const [ndcCandidates, setNdcCandidates] = useState<NdcLookupResult[]>([]);
  const [extractedRxNumber, setExtractedRxNumber] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suppressNextLookup = useRef(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const med = await medicationsStore.get(id);
      if (med) {
        setForm({
          name: med.name,
          brandOrCommonName: med.brandOrCommonName ?? '',
          ndc: med.ndc ?? '',
          rxNumber: med.rxNumber ?? '',
          amount: med.amount,
          frequency: med.frequency,
          timesOfDay: med.timesOfDay,
          notes: med.notes ?? '',
        });
      }
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (suppressNextLookup.current) {
      suppressNextLookup.current = false;
      return;
    }
    const query = form.name;
    if (query.trim().length < 2) {
      setNameSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchDrugNames(query).then((results) => {
        setNameSuggestions(results);
        setShowSuggestions(results.length > 0);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [form.name]);

  function selectNameSuggestion(raw: string) {
    suppressNextLookup.current = true;
    const parsed = parseDrugDisplayName(raw);
    setForm((prev) => ({
      ...prev,
      name: parsed.name,
      brandOrCommonName: prev.brandOrCommonName || parsed.brandOrCommonName || prev.brandOrCommonName,
      amount: prev.amount || parsed.amount || prev.amount,
    }));
    setShowSuggestions(false);
  }

  async function applyNdcLookup(ndc: string) {
    setNdcLooking(true);
    setNdcCandidates([]);
    try {
      const results = await lookupNdcCandidates(ndc);
      if (results.length === 0) {
        setScanInfo(`NDC read as ${ndc}, but no matching medication was found.`);
        return;
      }

      if (results.length === 1) {
        applyNdcMatch(results[0]);
        return;
      }

      setNdcCandidates(results);
      setScanInfo(`NDC read as ${ndc}. Pick the matching medication below.`);
    } finally {
      setNdcLooking(false);
    }
  }

  function applyNdcMatch(ndcResult: NdcLookupResult) {
    setForm((prev) => ({
      ...prev,
      ndc: ndcResult.ndc,
      name: prev.name || ndcResult.name,
      brandOrCommonName: prev.brandOrCommonName || ndcResult.brandOrCommonName || prev.brandOrCommonName,
      amount: prev.amount || ndcResult.amount || prev.amount,
    }));
    setHighlightMode(null);
    setNdcCandidates([]);
    setScanInfo(
      ndcResult.brandOrCommonName
        ? `Identified from NDC: ${ndcResult.name} (${ndcResult.brandOrCommonName}).`
        : `Identified from NDC: ${ndcResult.name}.`,
    );
  }

  function handleNdcBlur() {
    const ndc = form.ndc?.trim();
    if (ndc) void applyNdcLookup(ndc);
  }

  function toggleTime(tod: TimeOfDay) {
    setForm((prev) => {
      const timesOfDay = prev.timesOfDay.includes(tod)
        ? prev.timesOfDay.filter((t) => t !== tod)
        : [...prev.timesOfDay, tod];
      return {
        ...prev,
        timesOfDay,
        frequency: frequencyFromTimes(timesOfDay),
      };
    });
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanError(null);
    setScanInfo(null);
    setRxCandidates([]);
    setNdcCandidates([]);
    setHighlightMode(null);
    setExtractedRxNumber(null);
    setPendingImage(file);

    // BarcodeDetector can read the QR/data-matrix/barcode on many mobile
    // browsers. If Walgreens encodes NDC/Rx/label text in that code, use it;
    // otherwise fall back to OCR and manual selection.
    setScanning(true);
    try {
      const barcodeTexts = await readBarcodeTexts(file);
      if (barcodeTexts.length > 0) {
        const barcodeText = barcodeTexts.join('\n');
        const parsedBarcode = parseLabelText({ text: barcodeText });
        const barcodeNdc = parsedBarcode.ndc ?? extractLikelyNdcFromText(barcodeText);
        const barcodeRx = extractLikelyRxFromText(barcodeText);

        setForm((prev) => ({
          ...prev,
          ndc: prev.ndc || barcodeNdc || prev.ndc,
          rxNumber: prev.rxNumber || barcodeRx || prev.rxNumber,
          amount: prev.amount || parsedBarcode.amount || prev.amount,
          frequency: prev.frequency || parsedBarcode.frequency || prev.frequency,
        }));

        if (barcodeNdc) {
          await applyNdcLookup(barcodeNdc);
        } else if (barcodeRx) {
          setScanInfo('Read a barcode/QR code and filled the Rx number. Add the medication name once if this is a new prescription.');
        } else {
          setScanInfo('Read a barcode/QR code, but it did not expose a usable NDC or Rx number. Try manual NDC or Rx selection below.');
        }
      }

      const ocrResult = await recognizeLabelText(file);
      const parsed = parseLabelText(ocrResult);
      setForm((prev) => ({
        ...prev,
        amount: prev.amount || parsed.amount || prev.amount,
        frequency: prev.frequency || parsed.frequency || prev.frequency,
      }));

      if (parsed.ndc) {
        setForm((prev) => ({ ...prev, ndc: prev.ndc || parsed.ndc }));
        await applyNdcLookup(parsed.ndc);
      }
    } catch {
      setScanError('The automatic scan had trouble. Try manual NDC or Rx selection below.');
    } finally {
      setScanning(false);
    }
  }

  async function handleNdcHighlightResult(value: string) {
    setHighlightMode(null);
    setForm((prev) => ({ ...prev, ndc: value }));
    await applyNdcLookup(value);
  }

  async function handleRxHighlightResult(digits: string) {
    setHighlightMode(null);
    setExtractedRxNumber(digits);
    const known = await rxLookupStore.get(digits);
    if (known) {
      applyRxMatch(known);
      return;
    }
    const allEntries = await rxLookupStore.getAll();
    const candidates = findRxCandidates(digits, allEntries);
    if (candidates.length === 0) {
      setForm((prev) => ({ ...prev, rxNumber: digits }));
      setScanInfo(
        form.name
          ? `Rx# saved — we'll remember it's ${form.name} for refills.`
          : "New prescription — enter the medication name once below and we'll remember it for refills.",
      );
      return;
    }
    setRxCandidates(candidates);
  }

  function applyRxMatch(entry: RxLookupEntry) {
    setForm((prev) => ({
      ...prev,
      rxNumber: entry.rxNumber,
      name: entry.name,
      brandOrCommonName: entry.brandOrCommonName || '',
      amount: prev.amount || entry.amount,
      frequency: prev.frequency || entry.frequency,
      notes: prev.notes || entry.notes || '',
    }));
    setScanInfo(`Matched to a saved prescription — filled in ${entry.name}.`);
    setPendingImage(null);
    setHighlightMode(null);
    setRxCandidates([]);
    setNdcCandidates([]);
    setExtractedRxNumber(null);
  }

  function handleNoCandidateMatch() {
    if (extractedRxNumber) {
      setForm((prev) => ({ ...prev, rxNumber: extractedRxNumber }));
      setScanInfo(
        form.name
          ? `Rx# saved — we'll remember it's ${form.name} for refills.`
          : "New prescription — enter the medication name once below and we'll remember it for refills.",
      );
    }
    setPendingImage(null);
    setHighlightMode(null);
    setRxCandidates([]);
    setNdcCandidates([]);
    setExtractedRxNumber(null);
  }

  function cancelScan() {
    setPendingImage(null);
    setHighlightMode(null);
    setRxCandidates([]);
    setNdcCandidates([]);
    setExtractedRxNumber(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const now = new Date().toISOString();
    if (isEdit && id) {
      const existing = await medicationsStore.get(id);
      const med: Medication = {
        ...form,
        id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await medicationsStore.put(med);
    } else {
      const med: Medication = {
        ...form,
        id: uuid(),
        createdAt: now,
        updatedAt: now,
      };
      await medicationsStore.put(med);
    }
    if (form.rxNumber) {
      await rxLookupStore.put({
        rxNumber: form.rxNumber,
        name: form.name,
        brandOrCommonName: form.brandOrCommonName,
        amount: form.amount,
        frequency: form.frequency,
        notes: form.notes,
        updatedAt: now,
      });
    }
    navigate('/meds');
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page form-page">
      <header className="page-header">
        <h1>{isEdit ? 'Edit Medication' : 'Add Medication'}</h1>
      </header>

      <div className="scan-section">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScanFile}
          hidden
        />
        <button
          type="button"
          className="secondary-button scan-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanning}
        >
          {scanning ? 'Reading label + QR…' : '📷 Scan label, QR, or upload photo'}
        </button>
        {scanError && <p className="login-error">{scanError}</p>}
        {scanInfo && <p className="login-info">{scanInfo}</p>}

        {ndcCandidates.length > 0 && (
          <div className="rx-picker">
            <p className="rx-picker-hint">Multiple medications matched that NDC pattern:</p>
            <ul className="rx-candidate-list">
              {ndcCandidates.map((candidate) => (
                <li key={`${candidate.ndc}-${candidate.name}-${candidate.amount ?? ''}`}>
                  <button type="button" onClick={() => applyNdcMatch(candidate)}>
                    {candidate.name}
                    <span className="rx-candidate-meta">
                      NDC {candidate.ndc}
                      {candidate.brandOrCommonName ? ` • ${candidate.brandOrCommonName}` : ''}
                      {candidate.amount ? ` • ${candidate.amount}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {pendingImage && !highlightMode && rxCandidates.length === 0 && ndcCandidates.length === 0 && (
          <div className="rx-picker">
            <p className="rx-picker-hint">Need a tighter read? Select which number you want to drag around.</p>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setHighlightMode('ndc')}>
                Drag NDC
              </button>
              <button type="button" className="secondary-button" onClick={() => setHighlightMode('rx')}>
                Drag Rx #
              </button>
              <button type="button" className="secondary-button" onClick={cancelScan}>
                Done
              </button>
            </div>
          </div>
        )}

        {pendingImage && highlightMode && (
          <RxHighlightPicker
            image={pendingImage}
            mode={highlightMode}
            onResult={(value) => void (highlightMode === 'ndc' ? handleNdcHighlightResult(value) : handleRxHighlightResult(value))}
            onCancel={() => setHighlightMode(null)}
          />
        )}

        {rxCandidates.length > 0 && (
          <div className="rx-picker">
            <p className="rx-picker-hint">
              Read “{extractedRxNumber}” — which prescription is this?
            </p>
            <ul className="rx-candidate-list">
              {rxCandidates.map((c) => (
                <li key={c.rxNumber}>
                  <button type="button" onClick={() => applyRxMatch(c)}>
                    {c.name}
                    <span className="rx-candidate-meta">Rx# {c.rxNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={handleNoCandidateMatch}>
                None of these — new prescription
              </button>
            </div>
          </div>
        )}
      </div>

      <form className="med-form" onSubmit={handleSubmit}>
        <label>
          NDC (National Drug Code)
          <input
            value={form.ndc}
            onChange={(e) => setForm({ ...form, ndc: e.target.value })}
            onBlur={handleNdcBlur}
            placeholder="e.g. 00074-3368-13 or 00074336813"
          />
          {ndcLooking && <span className="login-info">Looking up…</span>}
        </label>

        <label className="name-field">
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onFocus={() => setShowSuggestions(nameSuggestions.length > 0)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
            placeholder="e.g. Lisinopril"
            autoComplete="off"
          />
          {showSuggestions && (
            <ul className="suggestion-list">
              {nameSuggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onMouseDown={() => selectNameSuggestion(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <label>
          Brand / common name
          <input
            value={form.brandOrCommonName}
            onChange={(e) => setForm({ ...form, brandOrCommonName: e.target.value })}
            placeholder="e.g. Prinivil (optional)"
          />
        </label>

        <label>
          Rx # (prescription number)
          <input
            value={form.rxNumber}
            onChange={(e) => setForm({ ...form, rxNumber: ndcDigits(e.target.value) })}
            placeholder="e.g. 1234567"
          />
        </label>

        <label>
          Amount / dose
          <input
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="e.g. 10mg, 1 tablet"
          />
        </label>

        <fieldset className="time-of-day-picker">
          <div className="time-of-day-header">
            <legend>Time(s) of day</legend>
            <span className="rx-candidate-meta">Frequency fills from this</span>
          </div>
          {TIMES_OF_DAY.map((tod) => (
            <label key={tod} className="checkbox-pill">
              <input
                type="checkbox"
                checked={form.timesOfDay.includes(tod)}
                onChange={() => toggleTime(tod)}
              />
              {TIME_OF_DAY_LABELS[tod]}
            </label>
          ))}
        </fieldset>

        <label>
          Frequency
          <input
            required
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            placeholder="e.g. Twice daily"
          />
        </label>

        <label>
          Notes
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional notes"
            rows={3}
          />
        </label>

        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={form.timesOfDay.length === 0}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
