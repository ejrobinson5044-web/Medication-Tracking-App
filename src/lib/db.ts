import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Medication, DoseLog } from './types';

interface MedTrackerDB extends DBSchema {
  medications: {
    key: string;
    value: Medication;
  };
  doseLogs: {
    key: string;
    value: DoseLog;
    indexes: { 'by-date': string; 'by-med': string };
  };
}

const DB_NAME = 'medication-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MedTrackerDB>> | null = null;

function getDb(): Promise<IDBPDatabase<MedTrackerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MedTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('medications')) {
          db.createObjectStore('medications', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('doseLogs')) {
          const store = db.createObjectStore('doseLogs', { keyPath: 'id' });
          store.createIndex('by-date', 'date');
          store.createIndex('by-med', 'medId');
        }
      },
    });
  }
  return dbPromise;
}

export const medicationsStore = {
  async getAll(): Promise<Medication[]> {
    const db = await getDb();
    return db.getAll('medications');
  },
  async get(id: string): Promise<Medication | undefined> {
    const db = await getDb();
    return db.get('medications', id);
  },
  async put(med: Medication): Promise<void> {
    const db = await getDb();
    await db.put('medications', med);
  },
  async delete(id: string): Promise<void> {
    const db = await getDb();
    await db.delete('medications', id);
    const tx = db.transaction('doseLogs', 'readwrite');
    const index = tx.store.index('by-med');
    for await (const cursor of index.iterate(id)) {
      await cursor.delete();
    }
    await tx.done;
  },
};

export const doseLogsStore = {
  async getByDate(date: string): Promise<DoseLog[]> {
    const db = await getDb();
    return db.getAllFromIndex('doseLogs', 'by-date', date);
  },
  async put(log: DoseLog): Promise<void> {
    const db = await getDb();
    await db.put('doseLogs', log);
  },
};
