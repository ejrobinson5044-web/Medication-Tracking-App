export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'bedtime' | 'asNeeded';

export const TIMES_OF_DAY: TimeOfDay[] = ['morning', 'noon', 'evening', 'bedtime', 'asNeeded'];

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  noon: 'Afternoon',
  evening: 'Evening',
  bedtime: 'Bedtime',
  asNeeded: 'As needed',
};

export const TIME_OF_DAY_CLOCK: Partial<Record<TimeOfDay, { hour: number; minute: number }>> = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 0 },
  evening: { hour: 18, minute: 0 },
  bedtime: { hour: 21, minute: 30 },
};

export interface Medication {
  id: string;
  name: string;
  brandOrCommonName?: string;
  ndc?: string;
  rxNumber?: string;
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

// A label scanned once for a given Rx number is reused on future scans
// (refills print the same Rx# with the same drug info) so OCR only has to
// get the name/dose/frequency right a single time per prescription.
export interface RxLookupEntry {
  rxNumber: string;
  name: string;
  brandOrCommonName?: string;
  amount: string;
  frequency: string;
  notes?: string;
  updatedAt: string;
}
