import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import { medicationsStore, rxLookupStore } from '../lib/db';
import { suggestTimesOfDay } from '../lib/frequency';
import { recognizeLabelText, parseLabelText } from '../lib/ocr';
import { searchDrugNames } from '../lib/drugSearch';
import { TIMES_OF_DAY, TIME_OF_DAY_LABELS, type Medication, type MedicationInput, type TimeOfDay } from '../lib/types';

const emptyForm: MedicationInput = {
  name: '',
  brandOrCommonName: '',
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
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
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

  function selectNameSuggestion(name: string) {
    suppressNextLookup.current = true;
    setForm((prev) => ({ ...prev, name }));
    setShowSuggestions(false);
  }

  function toggleTime(tod: TimeOfDay) {
    setForm((prev) => ({
      ...prev,
      timesOfDay: prev.timesOfDay.includes(tod)
        ? prev.timesOfDay.filter((t) => t !== tod)
        : [...prev.timesOfDay, tod],
    }));
  }

  function applySuggestedTimes() {
    const suggested = suggestTimesOfDay(form.frequency);
    if (suggested.length > 0) {
      setForm((prev) => ({ ...prev, timesOfDay: suggested }));
    }
  }

  function handleFrequencyBlur() {
    if (form.timesOfDay.length === 0) {
      applySuggestedTimes();
    }
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanning(true);
    setScanError(null);
    setScanInfo(null);
    try {
      const ocrResult = await recognizeLabelText(file);
      const parsed = parseLabelText(ocrResult);

      if (parsed.rxNumber) {
        const known = await rxLookupStore.get(parsed.rxNumber);
        if (known) {
          // We've seen this Rx# before (likely a refill) — trust the saved
          // details over a fresh OCR guess at the name.
          setForm((prev) => ({
            ...prev,
            rxNumber: known.rxNumber,
            name: known.name,
            brandOrCommonName: known.brandOrCommonName || '',
            amount: prev.amount || known.amount,
            frequency: prev.frequency || known.frequency,
            notes: prev.notes || known.notes || '',
          }));
          return;
        }
      }

      if (!parsed.amount && !parsed.frequency && !parsed.rxNumber) {
        setScanError("Couldn't make out the label clearly. Try a closer, well-lit photo, or enter details manually.");
        return;
      }
      setForm((prev) => ({
        ...prev,
        rxNumber: prev.rxNumber || parsed.rxNumber || prev.rxNumber,
        amount: prev.amount || parsed.amount || prev.amount,
        frequency: prev.frequency || parsed.frequency || prev.frequency,
      }));
      // The drug name isn't reliably readable off the label (patient name
      // usually dominates the OCR), so this is a new Rx# we haven't seen —
      // ask once, then it's remembered for every future refill.
      if (parsed.rxNumber) {
        setScanInfo("New prescription scanned — enter the medication name once below and we'll remember it for refills.");
      }
    } catch {
      setScanError('Scan failed. Try again or enter details manually.');
    } finally {
      setScanning(false);
    }
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
          {scanning ? 'Reading label…' : '📷 Scan a label or upload a photo'}
        </button>
        {scanError && <p className="login-error">{scanError}</p>}
        {scanInfo && <p className="login-info">{scanInfo}</p>}
      </div>

      <form className="med-form" onSubmit={handleSubmit}>
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
            onChange={(e) => setForm({ ...form, rxNumber: e.target.value })}
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

        <label>
          Frequency
          <input
            required
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            onBlur={handleFrequencyBlur}
            placeholder="e.g. Twice daily"
          />
        </label>

        <fieldset className="time-of-day-picker">
          <div className="time-of-day-header">
            <legend>Time(s) of day</legend>
            <button type="button" className="text-link" onClick={applySuggestedTimes}>
              Suggest from frequency
            </button>
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
