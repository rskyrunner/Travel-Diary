// IndexedDB storage. Everything (including receipt images) stays on the device.
const DB_NAME = 'travel-diary';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('trips', { keyPath: 'id' });
        db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('tripId', 'tripId');
        db.createObjectStore('receipts', { keyPath: 'id' }).createIndex('expenseId', 'expenseId');
        db.createObjectStore('diary', { keyPath: 'id' }).createIndex('tripId', 'tripId');
        db.createObjectStore('settings');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    let result;
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const db = {
  get: (store, key) => run(store, 'readonly', s => s.get(key)),
  all: (store) => run(store, 'readonly', s => s.getAll()),
  byIndex: (store, index, value) => run(store, 'readonly', s => s.index(index).getAll(value)),
  put: (store, value, key) => run(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
  clear: (store) => run(store, 'readwrite', s => s.clear()),
};

// ---- Settings -------------------------------------------------------------

// ATO cents-per-km rates (AUD per km), keyed by financial year.
// Only rates confirmed from the ATO are pre-filled. Add new years in Settings.
export const DEFAULT_KM_RATES = { '2024-25': 0.88, '2025-26': 0.88 };

const DEFAULT_SETTINGS = {
  claimantName: '',
  enhanceReceipts: true,
  kmRates: DEFAULT_KM_RATES,
  lastRates: {}, // currency -> AUD per 1 unit, remembered for convenience
};

export async function getSettings() {
  const s = (await db.get('settings', 'main')) || {};
  return { ...DEFAULT_SETTINGS, ...s, kmRates: { ...DEFAULT_KM_RATES, ...(s.kmRates || {}) } };
}

export async function saveSettings(patch) {
  const s = await getSettings();
  const next = { ...s, ...patch };
  await db.put('settings', next, 'main');
  return next;
}

// ---- Cascading deletes ----------------------------------------------------

export async function deleteExpense(id) {
  const receipts = await db.byIndex('receipts', 'expenseId', id);
  for (const r of receipts) await db.del('receipts', r.id);
  await db.del('expenses', id);
}

export async function deleteTrip(id) {
  const expenses = await db.byIndex('expenses', 'tripId', id);
  for (const e of expenses) await deleteExpense(e.id);
  const diary = await db.byIndex('diary', 'tripId', id);
  for (const d of diary) await db.del('diary', d.id);
  await db.del('trips', id);
}

// ---- Backup / restore -----------------------------------------------------

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export async function exportBackup() {
  const receipts = await db.all('receipts');
  return {
    app: 'travel-diary',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    trips: await db.all('trips'),
    expenses: await db.all('expenses'),
    diary: await db.all('diary'),
    receipts: receipts.map(r => ({ ...r, data: bufToB64(r.data) })),
  };
}

// Merges a backup into the current data (records with the same id are replaced).
export async function importBackup(data) {
  if (!data || data.app !== 'travel-diary') throw new Error('This file is not a Travel Diary backup.');
  for (const t of data.trips || []) await db.put('trips', t);
  for (const e of data.expenses || []) await db.put('expenses', e);
  for (const d of data.diary || []) await db.put('diary', d);
  for (const r of data.receipts || []) await db.put('receipts', { ...r, data: b64ToBuf(r.data) });
  if (data.settings) await saveSettings(data.settings);
  return { trips: (data.trips || []).length, expenses: (data.expenses || []).length, receipts: (data.receipts || []).length };
}
