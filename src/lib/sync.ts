import { supabase } from './supabase';
import { medicationsStore, doseLogsStore } from './db';
import type { Medication, DoseLog } from './types';

let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

function toRemoteMedication(med: Medication, userId: string) {
  return {
    id: med.id,
    user_id: userId,
    name: med.name,
    brand_or_common_name: med.brandOrCommonName ?? null,
    amount: med.amount,
    frequency: med.frequency,
    times_of_day: med.timesOfDay,
    notes: med.notes ?? null,
    created_at: med.createdAt,
    updated_at: med.updatedAt,
  };
}

function fromRemoteMedication(row: Record<string, unknown>): Medication {
  return {
    id: row.id as string,
    name: row.name as string,
    brandOrCommonName: (row.brand_or_common_name as string | null) ?? undefined,
    amount: row.amount as string,
    frequency: row.frequency as string,
    timesOfDay: row.times_of_day as Medication['timesOfDay'],
    notes: (row.notes as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toRemoteDoseLog(log: DoseLog, userId: string) {
  return {
    id: log.id,
    user_id: userId,
    med_id: log.medId,
    date: log.date,
    time_of_day: log.timeOfDay,
    taken: log.taken,
    taken_at: log.takenAt ?? null,
  };
}

function fromRemoteDoseLog(row: Record<string, unknown>): DoseLog {
  return {
    id: row.id as string,
    medId: row.med_id as string,
    date: row.date as string,
    timeOfDay: row.time_of_day as DoseLog['timeOfDay'],
    taken: row.taken as boolean,
    takenAt: (row.taken_at as string | null) ?? undefined,
  };
}

export async function pushMedication(med: Medication): Promise<void> {
  if (!supabase || !currentUserId) return;
  await supabase.from('medications').upsert(toRemoteMedication(med, currentUserId));
}

export async function deleteMedicationRemote(id: string): Promise<void> {
  if (!supabase || !currentUserId) return;
  await supabase.from('medications').delete().eq('id', id).eq('user_id', currentUserId);
}

export async function pushDoseLog(log: DoseLog): Promise<void> {
  if (!supabase || !currentUserId) return;
  await supabase.from('dose_logs').upsert(toRemoteDoseLog(log, currentUserId));
}

export async function pullRemoteData(userId: string): Promise<void> {
  if (!supabase) return;
  setCurrentUserId(userId);

  const [medsRes, logsRes] = await Promise.all([
    supabase.from('medications').select('*').eq('user_id', userId),
    supabase.from('dose_logs').select('*').eq('user_id', userId),
  ]);

  if (medsRes.data) {
    for (const row of medsRes.data) {
      await medicationsStore.put(fromRemoteMedication(row), { skipSync: true });
    }
  }
  if (logsRes.data) {
    for (const row of logsRes.data) {
      await doseLogsStore.put(fromRemoteDoseLog(row), { skipSync: true });
    }
  }
}
