import { db, getSettings, saveSettings, deleteExpense, deleteTrip, exportBackup, importBackup } from './db.js';
import {
  CATEGORIES, CAT, PAYMENT_METHODS, CURRENCIES, uid, esc, round2, num, aud, money, todayISO, fmtDate,
  fmtDateLong, nights, financialYear, summarise, sortExpenses, reportWarnings, slug, shareOrDownload,
} from './util.js';
import { processReceipt } from './image.js';
import { buildPdf, buildCsv } from './report.js';

const app = document.getElementById('app');
let objectUrls = [];

// ---- Helpers ----------------------------------------------------------------

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function receiptUrl(r) {
  const url = URL.createObjectURL(new Blob([r.data], { type: r.type || 'image/jpeg' }));
  objectUrls.push(url);
  return url;
}

function render(html) {
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

const bar = (title, { back, right = '' } = {}) => `
  <header class="bar">
    ${back ? `<a class="btn-bar" href="${back}" aria-label="Back">‹ Back</a>` : ''}
    <h1>${esc(title)}</h1>
    ${right}
  </header>`;

const go = (hash) => { location.hash = hash; };

function showViewer(src) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img alt="Receipt" src="${src}"><button type="button">Close</button>`;
  v.addEventListener('click', () => v.remove());
  document.body.appendChild(v);
}

async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* not supported */ }
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function loadTripData(tripId) {
  const [trip, expenses, diary] = await Promise.all([
    db.get('trips', tripId), db.byIndex('expenses', 'tripId', tripId), db.byIndex('diary', 'tripId', tripId),
  ]);
  return { trip, expenses, diary };
}

// ---- Trips list -------------------------------------------------------------

async function viewTrips() {
  const [trips, expenses] = await Promise.all([db.all('trips'), db.all('expenses')]);
  trips.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const totals = {};
  for (const e of expenses) {
    const t = totals[e.tripId] || (totals[e.tripId] = { aud: 0, count: 0 });
    t.aud += e.aud || 0; t.count++;
  }
  const install = isIOS() && !isStandalone() ? `
    <div class="notice info">To install: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. It will then open like an app and work offline.</div>` : '';

  render(`
    ${bar('Travel Diary', { right: '<a class="btn-bar" href="#/settings" aria-label="Settings">⚙︎</a>' })}
    <main>
      ${install}
      ${trips.length ? trips.map(t => {
        const tot = totals[t.id] || { aud: 0, count: 0 };
        return `
        <a class="card" href="#/trip/${t.id}">
          <div class="row">
            <div class="grow">
              <div class="ellipsis" style="font-weight:600">${esc(t.name)}</div>
              <div class="muted ellipsis">${esc(t.destination || '')}${t.destination ? ' · ' : ''}${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}</div>
            </div>
            <div class="right">
              <div class="amount">${aud(tot.aud)}</div>
              <div class="muted small">${tot.count} item${tot.count === 1 ? '' : 's'}</div>
            </div>
          </div>
        </a>`;
      }).join('') : `
        <div class="empty">
          <div class="emoji">🧳</div>
          <p><b>No trips yet</b></p>
          <p>Create a trip, then log flights, accommodation, meals, vehicle costs and mileage as you go.</p>
        </div>`}
    </main>
    <a class="fab" href="#/trip/new">＋ New trip</a>
  `);
}

// ---- Trip form ----------------------------------------------------------------

async function viewTripForm(id) {
  const trip = id ? await db.get('trips', id) : null;
  if (id && !trip) return go('#/');
  const t = trip || { name: '', destination: '', startDate: todayISO(), endDate: todayISO(), purpose: '', notes: '' };
  render(`
    ${bar(trip ? 'Edit trip' : 'New trip', { back: trip ? `#/trip/${id}` : '#/' })}
    <main>
      <form class="card" id="f" autocomplete="off">
        <div class="field"><label for="name">Trip name</label>
          <input id="name" name="name" required value="${esc(t.name)}" placeholder="e.g. Brisbane client visit"></div>
        <div class="field"><label for="destination">Destination</label>
          <input id="destination" name="destination" value="${esc(t.destination)}" placeholder="City, country"></div>
        <div class="grid2">
          <div class="field"><label for="startDate">Start date</label>
            <input id="startDate" type="date" name="startDate" required value="${esc(t.startDate)}"></div>
          <div class="field"><label for="endDate">End date</label>
            <input id="endDate" type="date" name="endDate" required value="${esc(t.endDate)}"></div>
        </div>
        <div class="field"><label for="purpose">Work purpose of the trip</label>
          <textarea id="purpose" name="purpose" placeholder="Why the travel was for work. The ATO asks for this.">${esc(t.purpose)}</textarea></div>
        <div class="field"><label for="notes">Notes</label>
          <textarea id="notes" name="notes">${esc(t.notes)}</textarea></div>
        <button class="btn block" type="submit">Save trip</button>
        ${trip ? '<div class="btn-row"><button class="btn danger" type="button" id="del">Delete trip</button></div>' : ''}
      </form>
    </main>
  `);
  const f = document.getElementById('f');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (d.endDate < d.startDate) return toast('End date is before the start date.');
    const rec = { ...(trip || { id: uid(), createdAt: Date.now() }), ...d, name: d.name.trim(), updatedAt: Date.now() };
    await db.put('trips', rec);
    requestPersistence();
    go(`#/trip/${rec.id}`);
  });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${trip.name}" and all its expenses, receipts and diary entries? This can't be undone.`)) return;
    await deleteTrip(trip.id);
    toast('Trip deleted');
    go('#/');
  });
}

// ---- Trip detail ------------------------------------------------------------

const tabs = (id, active) => `
  <nav class="tabs">
    <a href="#/trip/${id}" class="${active === 'expenses' ? 'active' : ''}">Expenses</a>
    <a href="#/trip/${id}/diary" class="${active === 'diary' ? 'active' : ''}">Diary</a>
    <a href="#/trip/${id}/report" class="${active === 'report' ? 'active' : ''}">Report</a>
  </nav>`;

function tripHeader(trip, sum) {
  const n = nights(trip.startDate, trip.endDate);
  const chips = CATEGORIES.filter(c => sum.byCat[c.id])
    .map(c => `<span class="chip">${c.icon} ${esc(c.label)} ${aud(sum.byCat[c.id].aud)}</span>`).join('');
  return `
    <div class="card">
      <div class="muted">${esc(trip.destination || '')}${trip.destination ? ' · ' : ''}${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate)} · ${n} night${n === 1 ? '' : 's'}</div>
      <div class="big">${aud(sum.total)}</div>
      <div class="muted small">${sum.count} item${sum.count === 1 ? '' : 's'} · GST ${aud(sum.gst)}${sum.km ? ` · ${sum.km} km` : ''}${sum.reimbursed ? ` · reimbursed ${aud(sum.reimbursed)}` : ''}</div>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
    </div>`;
}

async function viewTrip(id) {
  const { trip, expenses } = await loadTripData(id);
  if (!trip) return go('#/');
  const sum = summarise(expenses);
  const byDate = {};
  for (const e of sortExpenses(expenses).reverse()) (byDate[e.date] = byDate[e.date] || []).push(e);

  const groups = Object.keys(byDate).map(date => {
    const items = byDate[date];
    const dayTotal = items.reduce((s, e) => s + (e.aud || 0), 0);
    return `
      <div class="list">
        <div class="list-head"><span>${fmtDateLong(date)}</span><span>${aud(dayTotal)}</span></div>
        ${items.map(e => {
          const c = CAT[e.category] || CAT.other;
          const sub = e.category === 'mileage'
            ? `${e.km} km @ $${e.kmRate || '?'}/km`
            : (e.currency !== 'AUD' ? money(e.amount, e.currency) : (e.vendor || c.label));
          const noReceipt = e.category !== 'mileage' && !(e.receiptCount > 0);
          return `
          <a class="item" href="#/expense/${e.id}">
            <div class="icon">${c.icon}</div>
            <div class="grow">
              <div class="ellipsis">${esc(e.description || c.label)}</div>
              <div class="muted small ellipsis">${esc(sub)}
                ${e.receiptCount ? `<span class="tag">📎 ${e.receiptCount}</span>` : ''}
                ${noReceipt ? '<span class="tag warn">no receipt</span>' : ''}
                ${e.reimbursed ? '<span class="tag">reimbursed</span>' : ''}
              </div>
            </div>
            <div class="amount">${aud(e.aud)}</div>
          </a>`;
        }).join('')}
      </div>`;
  }).join('');

  render(`
    ${bar(trip.name, { back: '#/', right: `<a class="btn-bar" href="#/trip/${id}/edit">Edit</a>` })}
    <main>
      ${tripHeader(trip, sum)}
      ${tabs(id, 'expenses')}
      ${groups || `<div class="empty"><div class="emoji">🧾</div><p>No expenses yet. Tap <b>Add expense</b> to log your first cost and scan its receipt.</p></div>`}
    </main>
    <a class="fab" href="#/trip/${id}/expense/new">＋ Add expense</a>
  `);
}

// ---- Expense form -------------------------------------------------------------

async function viewExpenseForm({ tripId, id }) {
  const settings = await getSettings();
  let exp = null;
  let receipts = [];
  if (id) {
    exp = await db.get('expenses', id);
    if (!exp) return go('#/');
    tripId = exp.tripId;
    receipts = (await db.byIndex('receipts', 'expenseId', id)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  const trip = await db.get('trips', tripId);
  if (!trip) return go('#/');

  let defaults = {};
  if (!exp) {
    const siblings = sortExpenses(await db.byIndex('expenses', 'tripId', tripId));
    const lastMoney = [...siblings].reverse().find(e => e.category !== 'mileage');
    const today = todayISO();
    const date = today >= trip.startDate && today <= trip.endDate ? today : trip.startDate;
    const currency = lastMoney?.currency || 'AUD';
    defaults = {
      date, category: 'meals', currency, rate: currency === 'AUD' ? 1 : (settings.lastRates[currency] || ''),
      paymentMethod: lastMoney?.paymentMethod || PAYMENT_METHODS[0],
      vehicle: [...siblings].reverse().find(e => e.category === 'mileage')?.vehicle || '',
    };
  }
  const e = exp || {
    description: '', vendor: '', amount: '', aud: '', gst: '', notes: '', reimbursed: false,
    km: '', kmRate: settings.kmRates[financialYear(defaults.date)] || '', odoStart: '', odoEnd: '', ...defaults,
  };
  const pending = receipts.map(r => ({ ...r, isNew: false }));
  const removed = [];

  const v = (x) => (x === undefined || x === null ? '' : esc(x));
  render(`
    ${bar(exp ? 'Edit expense' : 'Add expense', { back: `#/trip/${tripId}` })}
    <main>
      <form id="f" autocomplete="off" novalidate>
        <div class="card">
          <div class="grid2">
            <div class="field"><label for="category">Category</label>
              <select id="category" name="category">
                ${CATEGORIES.map(c => `<option value="${c.id}" ${c.id === e.category ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}
              </select></div>
            <div class="field"><label for="date">Date</label>
              <input id="date" type="date" name="date" required value="${v(e.date)}"></div>
          </div>
          <div class="field"><label for="description">Description</label>
            <input id="description" name="description" value="${v(e.description)}" placeholder="e.g. Dinner, SYD → MEL flight"></div>
          <div class="field" data-money><label for="vendor">Vendor / supplier</label>
            <input id="vendor" name="vendor" value="${v(e.vendor)}" placeholder="e.g. Qantas, Hilton"></div>
        </div>

        <div class="card" data-money>
          <div class="grid2">
            <div class="field"><label for="currency">Currency</label>
              <input id="currency" name="currency" list="currencies" value="${v(e.currency)}" autocapitalize="characters" maxlength="3">
              <datalist id="currencies">${CURRENCIES.map(c => `<option value="${c}">`).join('')}</datalist></div>
            <div class="field"><label for="amount">Amount paid</label>
              <input id="amount" name="amount" inputmode="decimal" value="${v(e.amount)}" placeholder="0.00"></div>
          </div>
          <div class="grid2" data-fx>
            <div class="field"><label for="rate">AUD per 1 <span data-cur>${v(e.currency)}</span></label>
              <input id="rate" name="rate" inputmode="decimal" value="${v(e.rate)}" placeholder="e.g. 0.0102"></div>
            <div class="field"><label for="aud">Amount in AUD</label>
              <input id="aud" name="aud" inputmode="decimal" value="${v(e.aud)}" placeholder="0.00"></div>
          </div>
          <div class="hint" data-fx>Tip: enter the AUD amount from your card statement and the rate works itself out.</div>
          <div class="field" data-gst style="margin-top:12px"><label for="gst">GST included (AUD)</label>
            <div class="inline-btn">
              <input id="gst" name="gst" inputmode="decimal" value="${v(e.gst)}" placeholder="0.00">
              <button type="button" class="btn secondary small" id="gst11">1/11</button>
            </div>
            <div class="hint">Use 1/11 if the price includes 10% GST. Leave blank for GST-free items such as international flights.</div></div>
          <div class="field" style="margin-top:12px"><label for="paymentMethod">Paid with</label>
            <select id="paymentMethod" name="paymentMethod">
              ${PAYMENT_METHODS.map(p => `<option ${p === e.paymentMethod ? 'selected' : ''}>${p}</option>`).join('')}
            </select></div>
        </div>

        <div class="card" data-mileage>
          <div class="field"><label for="vehicle">Vehicle</label>
            <input id="vehicle" name="vehicle" value="${v(e.vehicle)}" placeholder="e.g. Toyota RAV4, ABC123"></div>
          <div class="grid2">
            <div class="field"><label for="odoStart">Odometer start</label>
              <input id="odoStart" name="odoStart" inputmode="numeric" value="${v(e.odoStart)}"></div>
            <div class="field"><label for="odoEnd">Odometer end</label>
              <input id="odoEnd" name="odoEnd" inputmode="numeric" value="${v(e.odoEnd)}"></div>
          </div>
          <div class="grid3">
            <div class="field"><label for="km">Work km</label>
              <input id="km" name="km" inputmode="decimal" value="${v(e.km)}"></div>
            <div class="field"><label for="kmRate">$ per km</label>
              <input id="kmRate" name="kmRate" inputmode="decimal" value="${v(e.kmRate)}"></div>
            <div class="field"><label for="mileageAud">AUD</label>
              <input id="mileageAud" readonly value="${v(e.aud)}"></div>
          </div>
          <div class="hint" id="kmHint"></div>
        </div>

        <div class="card">
          <h2>Receipts</h2>
          <div class="receipts" id="receipts"></div>
          <div class="btn-row">
            <label class="btn file-btn">📷 Scan receipt
              <input type="file" accept="image/*" capture="environment" id="scan"></label>
            <label class="btn secondary file-btn">🖼️ Add photo
              <input type="file" accept="image/*" multiple id="pick"></label>
          </div>
        </div>

        <div class="card">
          <label class="check"><input type="checkbox" name="reimbursed" ${e.reimbursed ? 'checked' : ''}> Reimbursed by employer / client</label>
          <div class="field"><label for="notes">Notes</label>
            <textarea id="notes" name="notes" placeholder="Who attended, business reason, etc.">${v(e.notes)}</textarea></div>
        </div>

        <button class="btn block" type="submit" id="save">Save expense</button>
        ${exp ? `<div class="btn-row"><button class="btn danger" type="button" id="del">Delete expense</button></div>` : ''}
      </form>
    </main>
  `);

  const f = document.getElementById('f');
  const el = (n) => f.elements[n];
  const show = (sel, on) => f.querySelectorAll(sel).forEach(x => { x.hidden = !on; });
  let kmRateEdited = !!exp;

  function refresh() {
    const mileage = el('category').value === 'mileage';
    const cur = (el('currency').value || 'AUD').toUpperCase();
    show('[data-money]', !mileage);
    show('[data-mileage]', mileage);
    show('[data-fx]', !mileage && cur !== 'AUD');
    show('[data-gst]', !mileage && cur === 'AUD');
    f.querySelectorAll('[data-cur]').forEach(x => { x.textContent = cur; });
    if (mileage) {
      const fy = financialYear(el('date').value);
      const known = settings.kmRates[fy];
      document.getElementById('kmHint').innerHTML = known
        ? `ATO rate for ${fy}: $${known}/km. The cents-per-km method covers all car running costs and is capped at 5,000 km per car each financial year.`
        : `No ATO rate saved for ${fy}. Enter it here, or add it in <a href="#/settings">Settings</a>.`;
    }
  }
  function calcMoney(source) {
    const cur = (el('currency').value || 'AUD').toUpperCase();
    const amount = num(el('amount').value);
    if (cur === 'AUD') { el('rate').value = 1; el('aud').value = amount ? round2(amount).toFixed(2) : ''; return; }
    if (source === 'aud') {
      const a = num(el('aud').value);
      if (amount && a) el('rate').value = +(a / amount).toPrecision(6);
    } else {
      const rate = num(el('rate').value);
      el('aud').value = amount && rate ? round2(amount * rate).toFixed(2) : '';
    }
  }
  function calcMileage() {
    const s = num(el('odoStart').value), en = num(el('odoEnd').value);
    if (s && en && en > s) el('km').value = round2(en - s);
    const km = num(el('km').value), rate = num(el('kmRate').value);
    document.getElementById('mileageAud').value = km && rate ? round2(km * rate).toFixed(2) : '';
  }

  el('category').addEventListener('change', refresh);
  el('date').addEventListener('change', () => {
    const r = settings.kmRates[financialYear(el('date').value)];
    if (!kmRateEdited && r) { el('kmRate').value = r; calcMileage(); }
    refresh();
  });
  el('currency').addEventListener('input', () => {
    const cur = el('currency').value.toUpperCase();
    if (cur.length === 3) {
      el('currency').value = cur;
      if (cur !== 'AUD' && settings.lastRates[cur]) el('rate').value = settings.lastRates[cur];
      if (cur !== 'AUD') el('gst').value = '';
      calcMoney('rate');
    }
    refresh();
  });
  el('amount').addEventListener('input', () => calcMoney('rate'));
  el('rate').addEventListener('input', () => calcMoney('rate'));
  el('aud').addEventListener('input', () => calcMoney('aud'));
  document.getElementById('gst11').addEventListener('click', () => {
    const a = num(el('amount').value);
    el('gst').value = a ? round2(a / 11).toFixed(2) : '';
  });
  ['odoStart', 'odoEnd', 'km'].forEach(n => el(n).addEventListener('input', calcMileage));
  el('kmRate').addEventListener('input', () => { kmRateEdited = true; calcMileage(); });

  // Receipts
  const box = document.getElementById('receipts');
  function drawReceipts() {
    box.innerHTML = pending.map((r, i) => `
      <div class="thumb"><img alt="Receipt ${i + 1}" src="${receiptUrl(r)}" data-i="${i}">
        <button type="button" class="remove" data-rm="${i}" aria-label="Remove receipt">×</button></div>`).join('')
      || '<div class="muted small" style="grid-column:1/-1">No receipts attached yet.</div>';
  }
  box.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) {
      if (!confirm('Remove this receipt?')) return;
      const [r] = pending.splice(+rm.dataset.rm, 1);
      if (!r.isNew) removed.push(r.id);
      drawReceipts();
      return;
    }
    const img = ev.target.closest('img[data-i]');
    if (img) showViewer(img.src);
  });
  async function addFiles(files) {
    const list = [...files];
    if (!list.length) return;
    toast(list.length > 1 ? `Processing ${list.length} images…` : 'Processing receipt…', 6000);
    for (const file of list) {
      try {
        const out = await processReceipt(file, settings.enhanceReceipts);
        pending.push({ id: uid(), ...out, createdAt: Date.now(), isNew: true });
      } catch (err) {
        toast(err.message || 'Could not add that image.');
      }
    }
    drawReceipts();
    toast(`${list.length > 1 ? 'Receipts' : 'Receipt'} added`);
  }
  ['scan', 'pick'].forEach(idName => {
    const input = document.getElementById(idName);
    input.addEventListener('change', async () => { await addFiles(input.files); input.value = ''; });
  });
  drawReceipts();
  refresh();

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const category = el('category').value;
    const mileage = category === 'mileage';
    const date = el('date').value;
    if (!date) return toast('Please choose a date.');
    const rec = {
      ...(exp || { id: uid(), tripId, createdAt: Date.now() }),
      category, date,
      description: el('description').value.trim(),
      notes: el('notes').value.trim(),
      reimbursed: el('reimbursed').checked,
      updatedAt: Date.now(),
    };
    if (mileage) {
      const km = num(el('km').value), kmRate = num(el('kmRate').value);
      if (!(km > 0)) return toast('Enter the work kilometres.');
      if (!(kmRate > 0)) return toast('Enter the rate per km.');
      Object.assign(rec, {
        km: round2(km), kmRate, vehicle: el('vehicle').value.trim(),
        odoStart: el('odoStart').value.trim(), odoEnd: el('odoEnd').value.trim(),
        currency: 'AUD', amount: round2(km * kmRate), rate: 1, aud: round2(km * kmRate), gst: 0,
        vendor: '', paymentMethod: '',
      });
    } else {
      const currency = (el('currency').value || 'AUD').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return toast('Currency should be a 3-letter code, e.g. AUD, USD.');
      const amount = num(el('amount').value);
      if (!(amount > 0)) return toast('Enter the amount paid.');
      let rate = 1, audAmt = round2(amount);
      if (currency !== 'AUD') {
        rate = num(el('rate').value);
        audAmt = round2(num(el('aud').value) || amount * rate);
        if (!(rate > 0) || !(audAmt > 0)) return toast(`Enter the exchange rate or the AUD amount for ${currency}.`);
      }
      const gst = currency === 'AUD' ? round2(num(el('gst').value)) : 0;
      if (gst > audAmt) return toast('GST can\'t be more than the amount.');
      Object.assign(rec, {
        currency, amount: round2(amount), rate, aud: audAmt, gst,
        vendor: el('vendor').value.trim(), paymentMethod: el('paymentMethod').value,
        km: 0, kmRate: 0, vehicle: '', odoStart: '', odoEnd: '',
      });
      if (currency !== 'AUD') await saveSettings({ lastRates: { ...settings.lastRates, [currency]: rate } });
    }
    rec.receiptCount = pending.length;
    document.getElementById('save').disabled = true;
    try {
      for (const r of pending.filter(x => x.isNew)) {
        const { isNew, ...stored } = r;
        await db.put('receipts', { ...stored, expenseId: rec.id });
      }
      for (const rid of removed) await db.del('receipts', rid);
      await db.put('expenses', rec);
    } catch (err) {
      document.getElementById('save').disabled = false;
      return toast(/quota/i.test(String(err)) ? 'Phone storage is full. Free up space or export a backup.' : 'Could not save: ' + err.message, 4000);
    }
    requestPersistence();
    toast('Saved');
    go(`#/trip/${tripId}`);
  });

  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm('Delete this expense and its receipts?')) return;
    await deleteExpense(exp.id);
    toast('Expense deleted');
    go(`#/trip/${tripId}`);
  });
}

// ---- Diary --------------------------------------------------------------------

async function viewDiary(id) {
  const { trip, expenses, diary } = await loadTripData(id);
  if (!trip) return go('#/');
  const n = nights(trip.startDate, trip.endDate);
  diary.sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
  const byDate = {};
  for (const d of diary) (byDate[d.date] = byDate[d.date] || []).push(d);
  render(`
    ${bar(trip.name, { back: '#/', right: `<a class="btn-bar" href="#/trip/${id}/edit">Edit</a>` })}
    <main>
      ${tripHeader(trip, summarise(expenses))}
      ${tabs(id, 'diary')}
      <div class="notice ${n >= 6 ? '' : 'info'}">
        ${n >= 6
          ? `This trip is ${n} nights. The ATO generally requires a travel diary for 6 or more nights in a row.`
          : 'A travel diary is optional for trips under 6 nights, but it helps support your claim.'}
        Record each work activity: date, start and end time, where you were and what you did.
      </div>
      ${Object.keys(byDate).map(date => `
        <div class="list">
          <div class="list-head"><span>${fmtDateLong(date)}</span></div>
          ${byDate[date].map(d => `
            <a class="item" href="#/diary/${d.id}">
              <div class="icon">📝</div>
              <div class="grow">
                <div class="ellipsis">${esc(d.activity || 'Activity')}</div>
                <div class="muted small ellipsis">${esc(d.startTime || '')}${d.endTime ? '–' + esc(d.endTime) : ''}${d.location ? ' · ' + esc(d.location) : ''}</div>
              </div>
            </a>`).join('')}
        </div>`).join('') || '<div class="empty"><div class="emoji">📔</div><p>No diary entries yet.</p></div>'}
    </main>
    <a class="fab" href="#/trip/${id}/diary/new">＋ Add entry</a>
  `);
}

async function viewDiaryForm({ tripId, id }) {
  let entry = null;
  if (id) { entry = await db.get('diary', id); if (!entry) return go('#/'); tripId = entry.tripId; }
  const trip = await db.get('trips', tripId);
  if (!trip) return go('#/');
  const today = todayISO();
  const d = entry || { date: today >= trip.startDate && today <= trip.endDate ? today : trip.startDate, startTime: '', endTime: '', location: trip.destination || '', activity: '' };
  render(`
    ${bar(entry ? 'Edit diary entry' : 'Diary entry', { back: `#/trip/${tripId}/diary` })}
    <main>
      <form class="card" id="f" autocomplete="off">
        <div class="field"><label for="date">Date</label><input id="date" type="date" name="date" required value="${esc(d.date)}"></div>
        <div class="grid2">
          <div class="field"><label for="startTime">Start time</label><input id="startTime" type="time" name="startTime" value="${esc(d.startTime)}"></div>
          <div class="field"><label for="endTime">End time</label><input id="endTime" type="time" name="endTime" value="${esc(d.endTime)}"></div>
        </div>
        <div class="field"><label for="location">Location</label><input id="location" name="location" value="${esc(d.location)}" placeholder="Where you were"></div>
        <div class="field"><label for="activity">Activity</label>
          <textarea id="activity" name="activity" required placeholder="e.g. Site inspection at client premises; lunch break 12:30–13:00">${esc(d.activity)}</textarea></div>
        <button class="btn block" type="submit">Save entry</button>
        ${entry ? '<div class="btn-row"><button class="btn danger" type="button" id="del">Delete entry</button></div>' : ''}
      </form>
    </main>
  `);
  const f = document.getElementById('f');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (!data.activity.trim()) return toast('Describe the activity.');
    await db.put('diary', { ...(entry || { id: uid(), tripId, createdAt: Date.now() }), ...data, activity: data.activity.trim() });
    toast('Saved');
    go(`#/trip/${tripId}/diary`);
  });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm('Delete this diary entry?')) return;
    await db.del('diary', entry.id);
    go(`#/trip/${tripId}/diary`);
  });
}

// ---- Report -------------------------------------------------------------------

async function loadReceiptsFor(expenses) {
  const out = {};
  for (const e of expenses) out[e.id] = await db.byIndex('receipts', 'expenseId', e.id);
  return out;
}

async function viewReport(id) {
  const { trip, expenses, diary } = await loadTripData(id);
  if (!trip) return go('#/');
  const sum = summarise(expenses);
  const warnings = reportWarnings(trip, expenses, diary);
  const receiptTotal = expenses.reduce((s, e) => s + (e.receiptCount || 0), 0);
  render(`
    ${bar(trip.name, { back: '#/', right: `<a class="btn-bar" href="#/trip/${id}/edit">Edit</a>` })}
    <main>
      ${tripHeader(trip, sum)}
      ${tabs(id, 'report')}
      <div class="card">
        <h2>Summary</h2>
        <table class="simple">
          <tr><th>Category</th><th class="num">Items</th><th class="num">AUD</th><th class="num">GST</th></tr>
          ${CATEGORIES.filter(c => sum.byCat[c.id]).map(c => `
            <tr><td>${c.icon} ${esc(c.label)}</td><td class="num">${sum.byCat[c.id].count}</td>
              <td class="num">${aud(sum.byCat[c.id].aud)}</td><td class="num">${aud(sum.byCat[c.id].gst)}</td></tr>`).join('')}
          <tr><th>Total</th><th class="num">${sum.count}</th><th class="num">${aud(sum.total)}</th><th class="num">${aud(sum.gst)}</th></tr>
          ${sum.reimbursed ? `<tr><td>Less reimbursed</td><td></td><td class="num">−${aud(sum.reimbursed)}</td><td></td></tr>
            <tr><th>Net, not reimbursed</th><th></th><th class="num">${aud(sum.net)}</th><th></th></tr>` : ''}
        </table>
        <p class="muted small">${receiptTotal} receipt image${receiptTotal === 1 ? '' : 's'} · ${diary.length} diary entr${diary.length === 1 ? 'y' : 'ies'}</p>
      </div>
      ${warnings.length ? `<div class="card"><h2>Before you send</h2>${warnings.map(w => `<div class="notice">${esc(w)}</div>`).join('')}</div>` : ''}
      <div class="card stack">
        <h2>Export</h2>
        <button class="btn block" id="pdf" ${expenses.length ? '' : 'disabled'}>📄 PDF report with receipts</button>
        <button class="btn secondary block" id="csv" ${expenses.length ? '' : 'disabled'}>📊 CSV spreadsheet</button>
        <p class="muted small">Opens the share sheet so you can save to Files, email it to your accountant, or AirDrop it.</p>
      </div>
    </main>
  `);

  const run = async (btnId, label, make, ext) => {
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Preparing…';
    try {
      const settings = await getSettings();
      const receiptsByExpense = await loadReceiptsFor(expenses);
      const blob = make({ trip, expenses, diary, receiptsByExpense, settings });
      const name = `Travel-Report-${slug(trip.name)}-${todayISO()}.${ext}`;
      const result = await shareOrDownload(blob, name);
      if (result === 'downloaded') toast(`${label} saved`);
    } catch (err) {
      console.error(err);
      toast(`Could not create the ${label}: ${err.message}`, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };
  document.getElementById('pdf').addEventListener('click', () => {
    if (!window.jspdf) return toast('PDF tool is still loading. Try again in a moment.');
    run('pdf', 'PDF', buildPdf, 'pdf');
  });
  document.getElementById('csv').addEventListener('click', () => run('csv', 'CSV', buildCsv, 'csv'));
}

// ---- Settings ---------------------------------------------------------------

async function viewSettings() {
  const s = await getSettings();
  let usage = '';
  try {
    if (navigator.storage?.estimate) {
      const { usage: u } = await navigator.storage.estimate();
      usage = `${(u / 1048576).toFixed(1)} MB used on this phone.`;
    }
    if (navigator.storage?.persisted && await navigator.storage.persisted()) usage += ' Storage is protected from automatic clean-up.';
  } catch { /* ignore */ }
  const years = Object.keys(s.kmRates).sort();
  const currentFy = financialYear(todayISO());

  render(`
    ${bar('Settings', { back: '#/' })}
    <main>
      <form class="card" id="f" autocomplete="off">
        <h2>Report details</h2>
        <div class="field"><label for="claimantName">Your name (shown on reports)</label>
          <input id="claimantName" name="claimantName" value="${esc(s.claimantName)}"></div>
        <label class="check"><input type="checkbox" name="enhanceReceipts" ${s.enhanceReceipts ? 'checked' : ''}> Enhance scanned receipts (black and white, higher contrast)</label>

        <h2 style="margin-top:16px">ATO cents per km rates</h2>
        <p class="muted small">AUD per km for each financial year. 2024–25 and 2025–26 are 88c/km. Check
          <a href="https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/work-related-deductions/cars-transport-and-travel/motor-vehicle-and-car-expenses/expenses-for-a-car-you-own-or-lease/cents-per-kilometre-method" target="_blank" rel="noopener">ato.gov.au</a>
          for later years.</p>
        <div id="rates">
          ${years.map(fy => `
            <div class="grid2 field" data-rate-row>
              <input name="fy" value="${esc(fy)}" placeholder="2026-27" pattern="\\d{4}-\\d{2}">
              <input name="rateVal" inputmode="decimal" value="${esc(s.kmRates[fy])}" placeholder="0.88">
            </div>`).join('')}
        </div>
        <button type="button" class="btn ghost small" id="addRate">＋ Add year</button>
        ${s.kmRates[currentFy] ? '' : `<div class="notice" style="margin-top:10px">No rate saved for the current financial year (${currentFy}).</div>`}
        <button class="btn block" type="submit" style="margin-top:16px">Save settings</button>
      </form>

      <div class="card stack">
        <h2>Backup</h2>
        <p class="muted small">Your trips and receipts are stored only on this phone. Export a backup regularly and save it to iCloud Drive or Files. ${esc(usage)}</p>
        <button class="btn secondary block" id="backup">⬇️ Export backup</button>
        <label class="btn ghost block file-btn">⬆️ Restore from backup
          <input type="file" accept=".json,application/json" id="restore"></label>
      </div>
      <p class="muted small" style="text-align:center">Travel Diary · data stays on your device</p>
    </main>
  `);

  const f = document.getElementById('f');
  document.getElementById('addRate').addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'grid2 field';
    row.dataset.rateRow = '';
    row.innerHTML = `<input name="fy" placeholder="e.g. ${currentFy}" pattern="\\d{4}-\\d{2}"><input name="rateVal" inputmode="decimal" placeholder="AUD per km">`;
    document.getElementById('rates').appendChild(row);
    row.querySelector('input').focus();
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const kmRates = {};
    for (const row of f.querySelectorAll('[data-rate-row]')) {
      const fy = row.querySelector('[name=fy]').value.trim();
      const rate = num(row.querySelector('[name=rateVal]').value);
      if (!fy && !rate) continue;
      if (!/^\d{4}-\d{2}$/.test(fy)) return toast('Financial year should look like 2026-27.');
      if (!(rate > 0 && rate < 10)) return toast(`Check the rate for ${fy}. It should be AUD per km, e.g. 0.88.`);
      kmRates[fy] = rate;
    }
    // Replace the whole table so deleted rows stay deleted.
    const current = await getSettings();
    await db.put('settings', {
      ...current, kmRates,
      claimantName: f.elements.claimantName.value.trim(),
      enhanceReceipts: f.elements.enhanceReceipts.checked,
    }, 'main');
    toast('Settings saved');
  });

  document.getElementById('backup').addEventListener('click', async () => {
    toast('Preparing backup…');
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    await shareOrDownload(blob, `Travel-Diary-backup-${todayISO()}.json`);
  });
  const restore = document.getElementById('restore');
  restore.addEventListener('change', async () => {
    const file = restore.files[0];
    restore.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm('Restore this backup? Matching records will be replaced. Other data on this phone is kept.')) return;
      const r = await importBackup(data);
      toast(`Restored ${r.trips} trips, ${r.expenses} expenses, ${r.receipts} receipts`, 3500);
      go('#/');
    } catch (err) {
      toast(err.message || 'Could not read that backup file.', 3500);
    }
  });
}

// ---- Router -----------------------------------------------------------------

async function route() {
  document.querySelectorAll('.viewer').forEach(v => v.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (!parts.length) return await viewTrips();
    if (parts[0] === 'settings') return await viewSettings();
    if (parts[0] === 'trip' && parts[1] === 'new') return await viewTripForm();
    if (parts[0] === 'trip' && parts[1]) {
      const id = parts[1];
      if (!parts[2]) return await viewTrip(id);
      if (parts[2] === 'edit') return await viewTripForm(id);
      if (parts[2] === 'report') return await viewReport(id);
      if (parts[2] === 'diary' && parts[3] === 'new') return await viewDiaryForm({ tripId: id });
      if (parts[2] === 'diary') return await viewDiary(id);
      if (parts[2] === 'expense' && parts[3] === 'new') return await viewExpenseForm({ tripId: id });
    }
    if (parts[0] === 'expense' && parts[1]) return await viewExpenseForm({ id: parts[1] });
    if (parts[0] === 'diary' && parts[1]) return await viewDiaryForm({ id: parts[1] });
    go('#/');
  } catch (err) {
    console.error(err);
    render(`${bar('Travel Diary', { back: '#/' })}<main><div class="notice">Something went wrong: ${esc(err.message)}</div></main>`);
  }
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
}
