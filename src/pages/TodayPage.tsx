import { useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { medicationsStore, doseLogsStore } from '../lib/db';
import { todayKey } from '../lib/date';
import { TIMES_OF_DAY, TIME_OF_DAY_LABELS, type Medication, type DoseLog, type TimeOfDay } from '../lib/types';
import { generateIcs, downloadIcs } from '../lib/ics';
import { checkInteractions } from '../lib/interactions';
import InteractionWarnings from '../components/InteractionWarnings';

interface ScheduledDose {
  med: Medication;
  timeOfDay: TimeOfDay;
  log?: DoseLog;
}

export default function TodayPage() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const date = todayKey();

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [allMeds, todaysLogs] = await Promise.all([medicationsStore.getAll(), doseLogsStore.getByDate(date)]);
    setMeds(allMeds);
    setLogs(todaysLogs);
    setLoading(false);
  }

  function getLog(medId: string, tod: TimeOfDay): DoseLog | undefined {
    return logs.find((l) => l.medId === medId && l.timeOfDay === tod);
  }

  const grouped = useMemo(() => {
    const map = new Map<TimeOfDay, ScheduledDose[]>();
    for (const tod of TIMES_OF_DAY) map.set(tod, []);
    for (const med of meds) {
      for (const tod of med.timesOfDay) {
        const log = getLog(med.id, tod);
        if (!(log?.taken ?? false)) {
          map.get(tod)!.push({ med, timeOfDay: tod, log });
        }
      }
    }
    return map;
  }, [meds, logs]);

  const takenDoses = useMemo(() => {
    const doses: ScheduledDose[] = [];
    for (const med of meds) {
      for (const tod of med.timesOfDay) {
        const log = getLog(med.id, tod);
        if (log?.taken) {
          doses.push({ med, timeOfDay: tod, log });
        }
      }
    }
    return doses.sort((a, b) => (a.log?.takenAt ?? '').localeCompare(b.log?.takenAt ?? ''));
  }, [meds, logs]);

  const interactionWarnings = useMemo(() => checkInteractions(meds), [meds]);

  const totalDoses = meds.reduce((sum, m) => sum + m.timesOfDay.length, 0);
  const takenCount = takenDoses.length;
  const remaining = totalDoses - takenCount;

  async function setDoseTaken(medId: string, tod: TimeOfDay, taken: boolean) {
    const existing = getLog(medId, tod);
    const log: DoseLog = {
      id: existing?.id ?? uuid(),
      medId,
      date,
      timeOfDay: tod,
      taken,
      takenAt: taken ? new Date().toISOString() : undefined,
    };
    await doseLogsStore.put(log);
    setLogs((prev) => {
      const others = prev.filter((l) => !(l.medId === medId && l.timeOfDay === tod));
      return [...others, log];
    });
  }

  async function handleDoseClick(dose: ScheduledDose, taken: boolean) {
    if (!taken) {
      await setDoseTaken(dose.med.id, dose.timeOfDay, true);
      return;
    }

    const confirmed = window.confirm(`Mark ${dose.med.name} as not taken for ${TIME_OF_DAY_LABELS[dose.timeOfDay]}?`);
    if (!confirmed) return;
    await setDoseTaken(dose.med.id, dose.timeOfDay, false);
  }

  function handleExport() {
    const ics = generateIcs(meds);
    downloadIcs(ics);
  }

  function renderDose(dose: ScheduledDose, taken: boolean) {
    return (
      <li key={`${dose.med.id}-${dose.timeOfDay}`} className={`dose-item ${taken ? 'taken' : ''}`}>
        <button className="dose-toggle" onClick={() => void handleDoseClick(dose, taken)}>
          <span className="checkbox" aria-hidden="true">
            {taken ? '✓' : ''}
          </span>
          <span className="dose-info">
            <span className="dose-name">{dose.med.name}</span>
            <span className="dose-meta">
              {dose.med.amount}
              {taken ? ` • ${TIME_OF_DAY_LABELS[dose.timeOfDay]}` : ''}
            </span>
          </span>
        </button>
      </li>
    );
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page today-page">
      <header className="page-header">
        <h1>Today</h1>
        <p className="remaining">
          {totalDoses === 0 ? 'No doses scheduled' : `${remaining} of ${totalDoses} doses remaining`}
        </p>
      </header>

      <InteractionWarnings warnings={interactionWarnings} />

      {meds.length === 0 ? (
        <p className="empty-state">No medications yet. Add one from the Medications tab.</p>
      ) : (
        <>
          {TIMES_OF_DAY.map((tod) => {
            const items = grouped.get(tod) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={tod} className="time-group">
                <h2>{TIME_OF_DAY_LABELS[tod]}</h2>
                <ul className="dose-list">{items.map((dose) => renderDose(dose, false))}</ul>
              </section>
            );
          })}

          {takenDoses.length > 0 && (
            <section className="time-group taken-group">
              <h2>Taken</h2>
              <ul className="dose-list">{takenDoses.map((dose) => renderDose(dose, true))}</ul>
            </section>
          )}
        </>
      )}

      {meds.length > 0 && (
        <button className="primary-button export-button" onClick={handleExport}>
          Export to Calendar
        </button>
      )}
    </div>
  );
}
