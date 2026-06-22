import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import { medicationsStore } from '../lib/db';
import { suggestTimesOfDay } from '../lib/frequency';
import { TIMES_OF_DAY, TIME_OF_DAY_LABELS, type Medication, type MedicationInput, type TimeOfDay } from '../lib/types';

const emptyForm: MedicationInput = {
  name: '',
  brandOrCommonName: '',
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

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const med = await medicationsStore.get(id);
      if (med) {
        setForm({
          name: med.name,
          brandOrCommonName: med.brandOrCommonName ?? '',
          amount: med.amount,
          frequency: med.frequency,
          timesOfDay: med.timesOfDay,
          notes: med.notes ?? '',
        });
      }
      setLoading(false);
    })();
  }, [id]);

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
    navigate('/meds');
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page form-page">
      <header className="page-header">
        <h1>{isEdit ? 'Edit Medication' : 'Add Medication'}</h1>
      </header>

      <form className="med-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Lisinopril"
          />
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
