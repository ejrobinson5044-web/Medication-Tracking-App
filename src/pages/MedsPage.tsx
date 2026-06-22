import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { medicationsStore } from '../lib/db';
import { checkInteractions } from '../lib/interactions';
import InteractionWarnings from '../components/InteractionWarnings';
import { TIME_OF_DAY_LABELS, type Medication } from '../lib/types';

export default function MedsPage() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setMeds(await medicationsStore.getAll());
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this medication?')) return;
    await medicationsStore.delete(id);
    setMeds((prev) => prev.filter((m) => m.id !== id));
  }

  const interactionWarnings = useMemo(() => checkInteractions(meds), [meds]);

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page meds-page">
      <header className="page-header">
        <h1>Medications</h1>
      </header>

      <InteractionWarnings warnings={interactionWarnings} />

      {meds.length === 0 ? (
        <p className="empty-state">No medications yet.</p>
      ) : (
        <ul className="med-list">
          {meds.map((med) => (
            <li key={med.id} className="med-card">
              <div className="med-card-main" onClick={() => navigate(`/meds/${med.id}/edit`)}>
                <div className="med-card-title">
                  {med.name}
                  {med.brandOrCommonName && <span className="med-brand"> ({med.brandOrCommonName})</span>}
                </div>
                <div className="med-card-meta">
                  {med.amount} &middot; {med.frequency}
                </div>
                <div className="med-card-times">
                  {med.timesOfDay.map((t) => TIME_OF_DAY_LABELS[t]).join(', ')}
                </div>
                {med.notes && <div className="med-card-notes">{med.notes}</div>}
              </div>
              <button className="danger-link" onClick={() => handleDelete(med.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <Link to="/meds/new" className="primary-button fab">
        + Add Medication
      </Link>
    </div>
  );
}
