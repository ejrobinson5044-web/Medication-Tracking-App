import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import { medicationsStore, rxLookupStore } from '../lib/db';
import { recognizeLabelText } from '../lib/ocr';
import { lookupNdcCandidates, lookupNdcCandidatesByName, type NdcLookupResult } from '../lib/ndcLookup';
import { searchDrugNames, parseDrugDisplayName } from '../lib/drugSearch';
import { readBarcodeTexts } from '../lib/barcode';
import { ndcDigits } from '../lib/ndc';
import { extractPdfScanInput } from '../lib/pdf';
import { parseMedicationListText } from '../lib/medListParser';
import { inferMedicationFromScanText, evidenceSummary } from '../lib/scanInference';
import RxHighlightPicker, { type HighlightMode } from '../components/RxHighlightPicker';
import {
  TIMES_OF_DAY,
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_CLOCK,
  type Medication,
  type MedicationInput,
  type ReminderSettings,
  type RxLookupEntry,
  type TimeOfDay,
} from '../lib/types';

type ScanSource = 'camera' | 'imageUpload' | null;
type ImageScanTarget = 'wholeLabel' | 'barcode' | 'numbers' | 'multiPhoto';

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function normalizeRxKey(value: string): string {
  return ndcDigits(value);
}

function cleanRxInput(value: string): string {
  return value.replace(/[^\d-]/g, '').replace(/-{2,}/g, '-');
}

function findRxCandidates(rxNumber: string, entries: RxLookupEntry[]): RxLookupEntry[] {
  const rxKey = normalizeRxKey(rxNumber);
  return entries
    .map((entry) => {
      const entryKey = normalizeRxKey(entry.rxNumber);
      return { entry, entryKey, distance: levenshtein(rxKey, entryKey) };
    })
    .filter(({ entryKey, distance }) => distance <= 2 || entryKey.includes(rxKey) || rxKey.includes(entryKey))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map(({ entry }) => entry);
}

function clockToInput(tod: TimeOfDay): string {
  const clock = TIME_OF_DAY_CLOCK[tod];
  if (!clock) return '';
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}

function defaultReminder(tod: TimeOfDay): ReminderSettings {
  return { enabled: tod !== 'asNeeded', time: clockToInput(tod), phone: true, email: false };
}

function frequencyFromTimes(times: TimeOfDay[]): string {
  if (times.includes('asNeeded')) return 'As needed';
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

const emptyForm: MedicationInput = {
  name: '',
  brandOrCommonName: '',
  ndc: '',
  rxNumber: '',
  amount: '',
  frequency: '',
  timesOfDay: [],
  reminderSettings: {},
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
  const [scanSource, setScanSource] = useState<ScanSource>(null);
  const [rxCandidates, setRxCandidates] = useState<RxLookupEntry[]>([]);
  const [ndcCandidates, setNdcCandidates] = useState<NdcLookupResult[]>([]);
  const [extractedRxNumber, setExtractedRxNumber] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const multiImageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
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
          reminderSettings: med.reminderSettings ?? {},
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

  function resetScanState() {
    setScanError(null);
    setScanInfo(null);
    setRxCandidates([]);
    setNdcCandidates([]);
    setHighlightMode(null);
    setExtractedRxNumber(null);
  }

  async function selectNameSuggestion(raw: string) {
    suppressNextLookup.current = true;
    const parsed = parseDrugDisplayName(raw);
    setForm((prev) => ({ ...prev, name: parsed.name, brandOrCommonName: prev.brandOrCommonName || parsed.brandOrCommonName || prev.brandOrCommonName, amount: prev.amount || parsed.amount || prev.amount }));
    setShowSuggestions(false);

    setNdcLooking(true);
    try {
      const results = await lookupNdcCandidatesByName(parsed.name);
      if (results.length === 1) {
        applyNdcMatch(results[0]);
      } else if (results.length > 1) {
        setNdcCandidates(results);
        setScanInfo(`Found ${results.length} possible NDCs for ${parsed.name}. Pick the matching one below.`);
      } else {
        setScanInfo(`Selected ${parsed.name}. No public NDC match was found automatically.`);
      }
    } finally {
      setNdcLooking(false);
    }
  }

  async function applyNdcLookup(ndc: string) {
    setNdcLooking(true);
    setNdcCandidates([]);
    try {
      const results = await lookupNdcCandidates(ndc);
      if (results.length === 0) {
        setScanInfo((prev) => `${prev ? `${prev} ` : ''}NDC read as ${ndc}, but no matching medication was found.`);
        return;
      }
      if (results.length === 1) {
        applyNdcMatch(results[0]);
        return;
      }
      setNdcCandidates(results);
      setScanInfo((prev) => `${prev ? `${prev} ` : ''}NDC read as ${ndc}. Pick the matching medication below.`);
    } finally {
      setNdcLooking(false);
    }
  }

  function applyNdcMatch(ndcResult: NdcLookupResult) {
    setForm((prev) => ({ ...prev, ndc: ndcResult.ndc, name: ndcResult.name || prev.name, brandOrCommonName: prev.brandOrCommonName || ndcResult.brandOrCommonName || prev.brandOrCommonName, amount: prev.amount || ndcResult.amount || prev.amount }));
    setNdcCandidates([]);
    setScanInfo((prev) => `${prev ? `${prev} ` : ''}${ndcResult.brandOrCommonName ? `Verified from NDC: ${ndcResult.name} (${ndcResult.brandOrCommonName}).` : `Verified from NDC: ${ndcResult.name}.`}`);
  }

  async function applyParsedText(text: string, sourceLabel: string) {
    const inference = inferMedicationFromScanText([text]);
    const name = inference.fields.name?.value as string | undefined;
    const ndc = inference.fields.ndc?.value as string | undefined;
    const rxNumber = inference.fields.rxNumber?.value as string | undefined;
    const amount = inference.fields.amount?.value as string | undefined;
    const frequency = inference.fields.frequency?.value as string | undefined;
    const timesOfDay = inference.fields.timesOfDay?.value as TimeOfDay[] | undefined;

    setForm((prev) => ({
      ...prev,
      name: prev.name || (inference.fields.name && inference.fields.name.confidence >= 60 ? name ?? prev.name : prev.name),
      ndc: prev.ndc || (inference.fields.ndc && inference.fields.ndc.confidence >= 65 ? ndc ?? prev.ndc : prev.ndc),
      rxNumber: prev.rxNumber || (inference.fields.rxNumber && inference.fields.rxNumber.confidence >= 70 ? rxNumber ?? prev.rxNumber : prev.rxNumber),
      amount: prev.amount || (inference.fields.amount && inference.fields.amount.confidence >= 70 ? amount ?? prev.amount : prev.amount),
      frequency: prev.frequency || (inference.fields.frequency && inference.fields.frequency.confidence >= 70 ? frequency ?? prev.frequency : prev.frequency),
      timesOfDay: prev.timesOfDay.length > 0 ? prev.timesOfDay : timesOfDay ?? prev.timesOfDay,
    }));

    const summary = `${sourceLabel}: ${evidenceSummary(inference)}`;
    const warnings = inference.warnings.length ? ` ${inference.warnings.join(' ')}` : '';
    setScanInfo(`${summary}${warnings}`);
    if (ndc && (inference.fields.ndc?.confidence ?? 0) >= 65) await applyNdcLookup(ndc);
    if (rxNumber && (inference.fields.rxNumber?.confidence ?? 0) >= 70) await handleRxHighlightResult(rxNumber);
  }

  async function handleFieldHighlightResult(mode: HighlightMode, value: string, rawText: string) {
    setHighlightMode(null);
    switch (mode) {
      case 'ndc':
        setForm((prev) => ({ ...prev, ndc: value }));
        setScanInfo(`Placed highlighted text into NDC: ${value}.`);
        await applyNdcLookup(value);
        break;
      case 'rx':
        setForm((prev) => ({ ...prev, rxNumber: cleanRxInput(value) }));
        setScanInfo(`Placed highlighted text into Rx #: ${cleanRxInput(value)}.`);
        await handleRxHighlightResult(cleanRxInput(value));
        break;
      case 'name':
        setForm((prev) => ({ ...prev, name: value }));
        setScanInfo(`Placed highlighted text into medication name: ${value}.`);
        break;
      case 'amount':
        setForm((prev) => ({ ...prev, amount: value }));
        setScanInfo(`Placed highlighted text into dose/amount: ${value}.`);
        break;
      case 'frequency': {
        const inference = inferMedicationFromScanText([rawText || value]);
        const frequency = (inference.fields.frequency?.value as string | undefined) ?? value;
        const timesOfDay = inference.fields.timesOfDay?.value as TimeOfDay[] | undefined;
        setForm((prev) => ({ ...prev, frequency, timesOfDay: timesOfDay?.length ? timesOfDay : prev.timesOfDay }));
        setScanInfo(`Placed highlighted directions into frequency: ${frequency}.`);
        break;
      }
      case 'notes':
        setForm((prev) => ({ ...prev, notes: prev.notes ? `${prev.notes}\n${value}` : value }));
        setScanInfo('Added highlighted text to notes.');
        break;
    }
  }

  function handleNdcBlur() {
    const ndc = form.ndc?.trim();
    if (ndc) void applyNdcLookup(ndc);
  }

  function toggleTime(tod: TimeOfDay) {
    setForm((prev) => {
      if (tod === 'asNeeded') {
        const timesOfDay: TimeOfDay[] = prev.timesOfDay.includes('asNeeded') ? [] : ['asNeeded'];
        return { ...prev, timesOfDay, frequency: frequencyFromTimes(timesOfDay) };
      }
      const withoutAsNeeded = prev.timesOfDay.filter((t) => t !== 'asNeeded');
      const timesOfDay = withoutAsNeeded.includes(tod) ? withoutAsNeeded.filter((t) => t !== tod) : [...withoutAsNeeded, tod];
      return { ...prev, timesOfDay, frequency: frequencyFromTimes(timesOfDay), reminderSettings: { ...prev.reminderSettings, [tod]: prev.reminderSettings?.[tod] ?? defaultReminder(tod), asNeeded: undefined } };
    });
  }

  function updateReminder(tod: TimeOfDay, patch: Partial<ReminderSettings>) {
    setForm((prev) => ({ ...prev, reminderSettings: { ...prev.reminderSettings, [tod]: { ...(prev.reminderSettings?.[tod] ?? defaultReminder(tod)), ...patch } } }));
  }

  function handleSource(source: NonNullable<ScanSource> | 'pdfUpload') {
    resetScanState();
    setPendingImage(null);
    if (source === 'pdfUpload') {
      setScanSource(null);
      pdfInputRef.current?.click();
      return;
    }
    setScanSource(source);
  }

  function handleImageTarget(target: ImageScanTarget) {
    if (target === 'multiPhoto') {
      multiImageInputRef.current?.click();
      return;
    }
    const input = scanSource === 'camera' ? cameraInputRef.current : imageInputRef.current;
    input?.setAttribute('data-target', target);
    input?.click();
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = (e.target.getAttribute('data-target') as ImageScanTarget | null) ?? 'wholeLabel';
    e.target.value = '';
    if (!file) return;
    await processImageFile(file, target);
  }

  async function handleMultiImageFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    resetScanState();
    setPendingImage(files[0]);
    setScanning(true);
    try {
      const textParts: string[] = [];
      for (const file of files.slice(0, 6)) {
        const [barcodeTexts, ocrResult] = await Promise.all([readBarcodeTexts(file), recognizeLabelText(file).catch(() => ({ text: '' }))]);
        textParts.push(...barcodeTexts, ocrResult.text);
      }
      await applyParsedText(textParts.filter(Boolean).join('\n'), `${files.length} photos`);
    } catch {
      setScanError('The multi-photo scan had trouble. Try fewer, sharper angles or use manual field highlighting.');
    } finally {
      setScanning(false);
    }
  }

  async function processImageFile(file: File | Blob, target: ImageScanTarget) {
    resetScanState();
    setPendingImage(file);
    setScanning(true);
    try {
      const textParts: string[] = [];
      if (target === 'barcode' || target === 'wholeLabel') {
        const barcodeTexts = await readBarcodeTexts(file);
        textParts.push(...barcodeTexts);
        if (target === 'barcode' && barcodeTexts.length === 0) {
          setScanInfo('No readable barcode or QR code was found. Use the field highlighter below to manually place text into each field.');
          return;
        }
      }
      if (target === 'numbers' || target === 'wholeLabel') {
        const ocrResult = await recognizeLabelText(file);
        textParts.push(ocrResult.text);
      }
      await applyParsedText(textParts.filter(Boolean).join('\n'), target === 'numbers' ? 'NDC/Rx number image' : target === 'barcode' ? 'Barcode/QR code' : 'Label image');
    } catch {
      setScanError('The scan had trouble. Use the field highlighter below to manually place text into each field.');
    } finally {
      setScanning(false);
    }
  }

  async function handlePdfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resetScanState();
    setPendingImage(null);
    setScanning(true);
    try {
      const pdfInput = await extractPdfScanInput(file);
      const pageTexts: string[] = [pdfInput.text];
      for (const image of pdfInput.pageImages) {
        const [barcodeTexts, ocrResult] = await Promise.all([readBarcodeTexts(image), recognizeLabelText(image).catch(() => ({ text: '' }))]);
        pageTexts.push(...barcodeTexts, ocrResult.text);
      }
      const combinedText = pageTexts.filter(Boolean).join('\n');
      const meds = parseMedicationListText(combinedText);
      const now = new Date().toISOString();
      if (meds.length > 1) {
        for (const parsedMed of meds) {
          const med: Medication = { ...parsedMed, id: uuid(), createdAt: now, updatedAt: now };
          await medicationsStore.put(med);
          if (med.rxNumber) await rxLookupStore.put({ rxNumber: med.rxNumber, name: med.name, brandOrCommonName: med.brandOrCommonName, amount: med.amount, frequency: med.frequency, notes: med.notes, updatedAt: now });
        }
        setScanInfo(`Imported ${meds.length} medications from the PDF.`);
        navigate('/meds');
        return;
      }
      if (meds.length === 1) {
        setForm((prev) => ({ ...prev, ...meds[0] }));
        if (meds[0].ndc) await applyNdcLookup(meds[0].ndc);
        setScanInfo('Found one medication in the PDF. Review it before saving.');
        return;
      }
      await applyParsedText(combinedText, 'PDF');
    } catch {
      setScanError('Could not read that PDF. Text-based PDFs work best; scanned PDFs may need a clearer export or image upload.');
    } finally {
      setScanning(false);
    }
  }

  async function handleRxHighlightResult(rxNumber: string) {
    const cleaned = cleanRxInput(rxNumber);
    const rxKey = normalizeRxKey(cleaned);
    setExtractedRxNumber(cleaned);

    const exact = await rxLookupStore.get(cleaned);
    if (exact) {
      applyRxMatch(exact);
      return;
    }

    const allEntries = await rxLookupStore.getAll();
    const normalizedExact = allEntries.find((entry) => normalizeRxKey(entry.rxNumber) === rxKey);
    if (normalizedExact) {
      applyRxMatch(normalizedExact);
      return;
    }

    const candidates = findRxCandidates(cleaned, allEntries);
    if (candidates.length > 0) setRxCandidates(candidates);
  }

  function applyRxMatch(entry: RxLookupEntry) {
    setForm((prev) => ({ ...prev, rxNumber: entry.rxNumber, name: entry.name, brandOrCommonName: entry.brandOrCommonName || '', amount: prev.amount || entry.amount, frequency: prev.frequency || entry.frequency, notes: prev.notes || entry.notes || '' }));
    setScanInfo((prev) => `${prev ? `${prev} ` : ''}Matched to a saved prescription — filled in ${entry.name}.`);
    setHighlightMode(null);
    setRxCandidates([]);
    setNdcCandidates([]);
    setExtractedRxNumber(null);
  }

  function handleNoCandidateMatch() {
    if (extractedRxNumber) setForm((prev) => ({ ...prev, rxNumber: extractedRxNumber }));
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
    const med: Medication = { ...form, id: isEdit && id ? id : uuid(), createdAt: isEdit && id ? (await medicationsStore.get(id))?.createdAt ?? now : now, updatedAt: now };
    await medicationsStore.put(med);
    if (form.rxNumber) await rxLookupStore.put({ rxNumber: form.rxNumber, name: form.name, brandOrCommonName: form.brandOrCommonName, amount: form.amount, frequency: form.frequency, notes: form.notes, updatedAt: now });
    navigate('/meds');
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page form-page">
      <header className="page-header"><h1>{isEdit ? 'Edit Medication' : 'Add Medication'}</h1></header>
      <div className="scan-section">
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageFile} hidden />
        <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageFile} hidden />
        <input ref={multiImageInputRef} type="file" accept="image/*" multiple onChange={handleMultiImageFiles} hidden />
        <input ref={pdfInputRef} type="file" accept="application/pdf" onChange={handlePdfFile} hidden />
        <div className="rx-picker"><p className="rx-picker-hint">What do you want to scan?</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => handleSource('camera')} disabled={scanning}>Take picture</button><button type="button" className="secondary-button" onClick={() => handleSource('imageUpload')} disabled={scanning}>Upload picture</button><button type="button" className="secondary-button" onClick={() => handleSource('pdfUpload')} disabled={scanning}>Upload PDF/list</button></div></div>
        {scanSource && <div className="rx-picker"><p className="rx-picker-hint">What is in the {scanSource === 'camera' ? 'picture' : 'uploaded image'}?</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => handleImageTarget('barcode')} disabled={scanning}>Barcode / QR</button><button type="button" className="secondary-button" onClick={() => handleImageTarget('numbers')} disabled={scanning}>NDC / Rx numbers</button><button type="button" className="secondary-button" onClick={() => handleImageTarget('wholeLabel')} disabled={scanning}>Whole label</button><button type="button" className="secondary-button" onClick={() => handleImageTarget('multiPhoto')} disabled={scanning}>Multi-photo bottle scan</button></div></div>}
        {scanning && <p className="login-info">Reading…</p>}
        {scanError && <p className="login-error">{scanError}</p>}
        {scanInfo && <p className="login-info">{scanInfo}</p>}
        {ndcCandidates.length > 0 && <div className="rx-picker"><p className="rx-picker-hint">Multiple NDC matches found:</p><ul className="rx-candidate-list">{ndcCandidates.map((candidate) => <li key={`${candidate.ndc}-${candidate.name}-${candidate.amount ?? ''}`}><button type="button" onClick={() => applyNdcMatch(candidate)}>{candidate.name}<span className="rx-candidate-meta">NDC {candidate.ndc}{candidate.brandOrCommonName ? ` • ${candidate.brandOrCommonName}` : ''}{candidate.amount ? ` • ${candidate.amount}` : ''}</span></button></li>)}</ul></div>}
        {pendingImage && !highlightMode && <div className="rx-picker"><p className="rx-picker-hint">Use this same photo to manually place fields. Pick a field, highlight it, then repeat for the next field.</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setHighlightMode('ndc')}>NDC Number</button><button type="button" className="secondary-button" onClick={() => setHighlightMode('rx')}>Rx Number</button><button type="button" className="secondary-button" onClick={() => setHighlightMode('name')}>Medication Name</button><button type="button" className="secondary-button" onClick={() => setHighlightMode('amount')}>Dose / Amount</button><button type="button" className="secondary-button" onClick={() => setHighlightMode('frequency')}>Directions / Frequency</button><button type="button" className="secondary-button" onClick={() => setHighlightMode('notes')}>Notes</button><button type="button" className="secondary-button" onClick={cancelScan}>Close photo</button></div></div>}
        {pendingImage && highlightMode && <RxHighlightPicker image={pendingImage} mode={highlightMode} onResult={(value, rawText) => void handleFieldHighlightResult(highlightMode, value, rawText)} onCancel={() => setHighlightMode(null)} />}
        {rxCandidates.length > 0 && <div className="rx-picker"><p className="rx-picker-hint">Read “{extractedRxNumber}” — which prescription is this?</p><ul className="rx-candidate-list">{rxCandidates.map((c) => <li key={c.rxNumber}><button type="button" onClick={() => applyRxMatch(c)}>{c.name}<span className="rx-candidate-meta">Rx# {c.rxNumber}</span></button></li>)}</ul><div className="form-actions"><button type="button" className="secondary-button" onClick={handleNoCandidateMatch}>None of these — new prescription</button></div></div>}
      </div>
      <form className="med-form" onSubmit={handleSubmit}>
        <label>NDC (National Drug Code)<input value={form.ndc} onChange={(e) => setForm({ ...form, ndc: e.target.value })} onBlur={handleNdcBlur} placeholder="e.g. 00074-3368-13 or 00074336813" />{ndcLooking && <span className="login-info">Looking up…</span>}</label>
        <label className="name-field">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onFocus={() => setShowSuggestions(nameSuggestions.length > 0)} onBlur={() => setTimeout(() => setShowSuggestions(false), 100)} placeholder="e.g. Lisinopril" autoComplete="off" />{showSuggestions && <ul className="suggestion-list">{nameSuggestions.map((suggestion) => <li key={suggestion}><button type="button" onMouseDown={() => void selectNameSuggestion(suggestion)}>{suggestion}</button></li>)}</ul>}</label>
        <label>Brand / common name<input value={form.brandOrCommonName} onChange={(e) => setForm({ ...form, brandOrCommonName: e.target.value })} placeholder="e.g. Prinivil (optional)" /></label>
        <label>Rx # (prescription number)<input value={form.rxNumber} onChange={(e) => setForm({ ...form, rxNumber: cleanRxInput(e.target.value) })} placeholder="e.g. 123-4567 or 1234567" /></label>
        <label>Amount / dose<input required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 10mg, 1 tablet" /></label>
        <fieldset className="time-of-day-picker"><div className="time-of-day-header"><legend>Time(s) of day</legend><span className="rx-candidate-meta">Frequency fills from this</span></div>{TIMES_OF_DAY.map((tod) => <label key={tod} className="checkbox-pill"><input type="checkbox" checked={form.timesOfDay.includes(tod)} onChange={() => toggleTime(tod)} />{TIME_OF_DAY_LABELS[tod]}</label>)}</fieldset>
        <label>Frequency<input required value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} placeholder="e.g. Twice daily or As needed" /></label>
        {form.timesOfDay.length > 0 && !form.timesOfDay.includes('asNeeded') && <fieldset className="time-of-day-picker"><div className="time-of-day-header"><legend>Reminder settings</legend><span className="rx-candidate-meta">Used by calendar export now; email/SMS needs backend delivery later</span></div>{form.timesOfDay.map((tod) => { const settings = form.reminderSettings?.[tod] ?? defaultReminder(tod); return <div key={tod} className="rx-picker"><p className="rx-picker-hint">{TIME_OF_DAY_LABELS[tod]} reminder</p><label className="checkbox-pill"><input type="checkbox" checked={settings.enabled} onChange={(e) => updateReminder(tod, { enabled: e.target.checked })} />Enable reminder</label><label>Reminder time<input type="time" value={settings.time} onChange={(e) => updateReminder(tod, { time: e.target.value })} /></label><label className="checkbox-pill"><input type="checkbox" checked={settings.phone} onChange={(e) => updateReminder(tod, { phone: e.target.checked })} />Phone/calendar alert</label><label className="checkbox-pill"><input type="checkbox" checked={settings.email} onChange={(e) => updateReminder(tod, { email: e.target.checked })} />Email reminder</label></div>; })}</fieldset>}
        <label>Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" rows={3} /></label>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => navigate(-1)}>Cancel</button><button type="submit" className="primary-button" disabled={form.timesOfDay.length === 0}>Save</button></div>
      </form>
    </div>
  );
}
