import { db } from './db.js';

const KNOWN_STORES = [
  'settings', 'categories', 'flashcards', 'study_sessions',
  'review_history', 'ai_conversations', 'exams', 'exam_results',
];

export async function wipeAllData() {
  const d = await db.getDb();
  const stores = Array.from(d.objectStoreNames);

  const promises = stores.map(storeName => {
    return new Promise((resolve, reject) => {
      const transaction = d.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  });

  await Promise.all(promises);
}

// Settings that must never leave the device in a shareable backup file.
const SENSITIVE_SETTING_KEYS = new Set(['gemini_api_key']);

/**
 * Builds the backup as a plain JS object (not yet stringified), so the
 * caller (Settings > System & Backup) can decide how to serialize/name/
 * download the file. Includes a small `meta` block so a restored file
 * can be sanity-checked by validateBackup() before wiping the user's data.
 */
export async function exportBackup() {
  const d = await db.getDb();
  const stores = Array.from(d.objectStoreNames);
  const backup = {};

  for (const storeName of stores) {
    backup[storeName] = await new Promise((resolve, reject) => {
      const transaction = d.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  if (Array.isArray(backup.settings)) {
    backup.settings = backup.settings.filter((s) => !SENSITIVE_SETTING_KEYS.has(s.key));
  }

  backup.meta = {
    app: 'personal-learning-os',
    version: 1,
    exportedAt: new Date().toISOString(),
  };

  return backup;
}

/**
 * Lightweight sanity check for a parsed backup file before it's used to
 * wipe and replace the user's current data. Returns a Persian error
 * message string if the file looks invalid, or null/undefined if it's OK
 * to proceed.
 */
export function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return 'ساختار فایل پشتیبان معتبر نیست.';
  }

  const hasAnyKnownStore = KNOWN_STORES.some((storeName) => Array.isArray(backup[storeName]));
  if (!hasAnyKnownStore) {
    return 'این فایل هیچ داده‌ی قابل بازیابی (دسته، فلش‌کارت و غیره) ندارد.';
  }

  for (const storeName of KNOWN_STORES) {
    if (storeName in backup && !Array.isArray(backup[storeName])) {
      return `بخش «${storeName}» در فایل پشتیبان نامعتبر است.`;
    }
  }

  return null;
}

/**
 * Restores a previously-exported backup object (already JSON.parse()'d
 * by the caller). Wipes all current data first, then repopulates every
 * known object store from the backup.
 */
export async function importBackup(backup) {
  const d = await db.getDb();

  // Wipe first
  await wipeAllData();

  for (const storeName of Object.keys(backup)) {
    if (storeName === 'meta') continue;
    if (!d.objectStoreNames.contains(storeName)) continue;

    const records = backup[storeName];
    if (!Array.isArray(records)) continue;

    const transaction = d.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);

    for (const record of records) {
      await new Promise((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    }
  }
}

// --- Backward-compatible string-based helpers (kept in case any other
// code path still expects a JSON string in/out, matching the original
// API this module shipped with). ---
export async function exportBackupData() {
  const backup = await exportBackup();
  return JSON.stringify(backup, null, 2);
}

export async function importBackupData(jsonString) {
  const backup = JSON.parse(jsonString);
  await importBackup(backup);
}
