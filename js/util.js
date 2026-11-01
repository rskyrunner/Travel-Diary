export const CATEGORIES = [
  { id: 'flights', label: 'Flights', icon: '✈️' },
  { id: 'accommodation', label: 'Accommodation', icon: '🏨' },
  { id: 'meals', label: 'Meals', icon: '🍽️' },
  { id: 'car-hire', label: 'Car hire', icon: '🚗' },
  { id: 'fuel', label: 'Fuel', icon: '⛽' },
  { id: 'tolls-parking', label: 'Tolls & parking', icon: '🅿️' },
  { id: 'mileage', label: 'Mileage (own car)', icon: '🛣️' },
  { id: 'taxi', label: 'Taxi & rideshare', icon: '🚕' },
  { id: 'public-transport', label: 'Public transport', icon: '🚆' },
  { id: 'conference', label: 'Conference & registration', icon: '🎫' },
  { id: 'incidentals', label: 'Incidentals', icon: '🧾' },
  { id: 'other', label: 'Other', icon: '📌' },
];
export const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const PAYMENT_METHODS = ['Personal card', 'Cash', 'Company card', 'Other'];

export const CURRENCIES = ['AUD', 'NZD', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD', 'CNY', 'IDR', 'THB',
  'MYR', 'VND', 'PHP', 'KRW', 'INR', 'FJD', 'CAD', 'CHF', 'AED', 'ZAR'];

export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

const audFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
export const aud = (n) => audFmt.format(n || 0);
export const money = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
export const fmtDateLong = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
export const nights = (start, end) => {
  if (!start || !end) return 0;
  const ms = Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z');
  return Math.max(0, Math.round(ms / 86400000));
};

// Australian financial year for an ISO date, e.g. 2025-08-01 -> "2025-26".
export const financialYear = (iso) => {
  const [y, m] = (iso || todayISO()).split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export const sortExpenses = (list) => [...list].sort((a, b) =>
  (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));

export function summarise(expenses) {
  const byCat = {};
  let total = 0, gst = 0, reimbursed = 0, km = 0, mileageAud = 0, foreign = 0;
  for (const e of expenses) {
    const c = byCat[e.category] || (byCat[e.category] = { count: 0, aud: 0, gst: 0 });
    c.count++; c.aud += e.aud || 0; c.gst += e.gst || 0;
    total += e.aud || 0; gst += e.gst || 0;
    if (e.reimbursed) reimbursed += e.aud || 0;
    if (e.category === 'mileage') { km += e.km || 0; mileageAud += e.aud || 0; }
    if (e.currency && e.currency !== 'AUD') foreign++;
  }
  for (const k in byCat) { byCat[k].aud = round2(byCat[k].aud); byCat[k].gst = round2(byCat[k].gst); }
  return {
    byCat, count: expenses.length, total: round2(total), gst: round2(gst),
    reimbursed: round2(reimbursed), net: round2(total - reimbursed),
    km: round2(km), mileageAud: round2(mileageAud), foreign,
  };
}

// Record-keeping checks shown before generating a report.
export function reportWarnings(trip, expenses, diary) {
  const w = [];
  const noReceipt = expenses.filter(e => e.category !== 'mileage' && !(e.receiptCount > 0));
  if (noReceipt.length) w.push(`${noReceipt.length} expense${noReceipt.length > 1 ? 's have' : ' has'} no receipt attached.`);
  const n = nights(trip.startDate, trip.endDate);
  if (n >= 6 && !diary.length) w.push(`This trip is ${n} nights. The ATO generally requires a travel diary for 6 or more nights in a row. Add entries in the Diary tab.`);
  const hasMileage = expenses.some(e => e.category === 'mileage');
  if (hasMileage && expenses.some(e => e.category === 'fuel')) {
    w.push('You have Mileage and Fuel entries. Under the cents-per-km method you can\'t also claim fuel for the same car (fuel for a hire car is fine).');
  }
  if (expenses.some(e => e.category === 'mileage' && !(e.kmRate > 0))) w.push('A mileage entry has no rate per km. Set the ATO rate in Settings and re-save the entry.');
  if (expenses.some(e => !trip.startDate || !trip.endDate || e.date < trip.startDate || e.date > trip.endDate)) {
    w.push('Some expenses are dated outside the trip dates.');
  }
  return w;
}

export function slug(s) {
  return String(s || 'trip').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'trip';
}

// Share a file via the iOS share sheet (Save to Files, Mail, AirDrop…), or download it.
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
