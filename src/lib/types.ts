export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'bedtime';

export const TIMES_OF_DAY: TimeOfDay[] = ['morning', 'noon', 'evening', 'bedtime'];

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  noon: 'Noon',
  evening: 'Evening',
  bedtime: 'Bedtime',
};

export const TIME_OF_DAY_CLOCK: Record<TimeOfDay, { hour: number; minute: number }> = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 0 },
  evening: { hour: 18, minute: 0 },
  bedtime: { hour: 21, minute: 30 },
};

export interface Medication {
  id: string;
  name: string;
  brandOrCommonName?: string;
  amount: string;
  frequency: string;
  timesOfDay: TimeOfDay[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type MedicationInput = Omit<Medication, 'id' | 'createdAt' | 'updatedAt'>;

export interface DoseLog {
  id: string;
  medId: string;
  date: string;
  timeOfDay: TimeOfDay;
  taken: boolean;
  takenAt?: string;
}
