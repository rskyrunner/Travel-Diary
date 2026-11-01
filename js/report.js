import { CAT, CATEGORIES, fmtDate, nights, financialYear, summarise, sortExpenses, reportWarnings, round2, todayISO } from './util.js';

// Standard PDF fonts only cover Latin-1, so tidy up anything outside it.
const pdfText = (s) => String(s ?? '').normalize('NFC')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/€/g, 'EUR ').replace(/[^\x00-\xFF]/g, '?');

const n2 = (n) => Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (n) => '$' + n2(n);

function paidCell(e) {
  if (e.category === 'mileage') return `${n2(e.km)} km`;
  return `${e.currency || 'AUD'} ${n2(e.amount)}`;
}
function rateCell(e) {
  if (e.category === 'mileage') return e.kmRate ? `$${e.kmRate}/km` : '';
  if (e.currency && e.currency !== 'AUD') return String(e.rate ?? '');
  return '';
}
function descCell(e) {
  const parts = [e.description || CAT[e.category]?.label || ''];
  if (e.vendor) parts[0] += ` - ${e.vendor}`;
  if (e.category === 'mileage') {
    const bits = [];
    if (e.vehicle) bits.push(e.vehicle);
    if (e.odoStart || e.odoEnd) bits.push(`odometer ${e.odoStart || '?'} to ${e.odoEnd || '?'}`);
    if (bits.length) parts.push(bits.join(', '));
  }
  const flags = [];
  if (e.paymentMethod && e.category !== 'mileage') flags.push(e.paymentMethod);
  if (e.reimbursed) flags.push('REIMBURSED');
  if (flags.length) parts.push(`[${flags.join(', ')}]`);
  if (e.notes) parts.push(e.notes);
  return parts.join('\n');
}

// Gives each receipt a reference (R1, R2…) in the order expenses appear in the report.
function numberReceipts(expenses, receiptsByExpense) {
  const list = [];
  const refs = {};
  for (const e of expenses) {
    const rs = (receiptsByExpense[e.id] || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    refs[e.id] = rs.map(r => { const ref = `R${list.length + 1}`; list.push({ ref, r, e }); return ref; });
  }
  return { list, refs };
}

export function buildPdf({ trip, expenses, diary, receiptsByExpense, settings }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setLineHeightFactor(1.2);
  const M = 12, W = 186, TOP = 16, BOTTOM = 284;
  let y = 0;

  const sorted = sortExpenses(expenses);
  const sum = summarise(sorted);
  const { list: receipts, refs } = numberReceipts(sorted, receiptsByExpense);
  const n = nights(trip.startDate, trip.endDate);

  const font = (style = 'normal', size = 10, color = [17, 24, 39]) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const newPage = () => { doc.addPage(); y = TOP; };
  const ensure = (h) => { if (y + h > BOTTOM) { newPage(); return true; } return false; };

  const heading = (text) => {
    ensure(16);
    y += 3;
    font('bold', 12, [15, 118, 110]);
    doc.text(pdfText(text), M, y);
    y += 2;
    doc.setDrawColor(15, 118, 110); doc.setLineWidth(0.4); doc.line(M, y, M + W, y);
    y += 5;
  };

  const paragraph = (text, size = 9, color = [55, 65, 81]) => {
    font('normal', size, color);
    const lines = doc.splitTextToSize(pdfText(text), W);
    const lh = size * 1.2 * 0.3528;
    for (const line of lines) { ensure(lh); doc.text(line, M, y + lh * 0.8); y += lh; }
    y += 1.5;
  };

  const table = (cols, rows) => {
    const drawHeader = () => {
      doc.setFillColor(15, 118, 110); doc.rect(M, y, W, 7, 'F');
      font('bold', 8, [255, 255, 255]);
      let x = M;
      for (const c of cols) {
        const right = c.align === 'right';
        doc.text(pdfText(c.h), right ? x + c.w - 1.5 : x + 1.5, y + 4.7, { align: right ? 'right' : 'left' });
        x += c.w;
      }
      y += 7;
    };
    ensure(14);
    drawHeader();
    rows.forEach((row, i) => {
      font(row.bold ? 'bold' : 'normal', 8);
      const cells = row.cells.map((cell, j) => doc.splitTextToSize(pdfText(cell), cols[j].w - 3));
      const h = Math.max(...cells.map(l => l.length)) * 3.39 + 2.4;
      if (y + h > BOTTOM) { newPage(); drawHeader(); font(row.bold ? 'bold' : 'normal', 8); }
      if (row.bold) { doc.setFillColor(204, 251, 241); doc.rect(M, y, W, h, 'F'); }
      else if (i % 2) { doc.setFillColor(243, 244, 246); doc.rect(M, y, W, h, 'F'); }
      let x = M;
      cells.forEach((lines, j) => {
        const right = cols[j].align === 'right';
        doc.text(lines, right ? x + cols[j].w - 1.5 : x + 1.5, y + 3.9, { align: right ? 'right' : 'left' });
        x += cols[j].w;
      });
      y += h;
    });
    y += 4;
  };

  // ---- Cover band -------------------------------------------------------
  doc.setFillColor(15, 118, 110); doc.rect(0, 0, 210, 30, 'F');
  font('bold', 18, [255, 255, 255]);
  doc.text('Travel Expense Report', M, 14);
  font('normal', 11, [255, 255, 255]);
  doc.text(pdfText(trip.name || 'Trip'), M, 22);
  y = 38;

  // ---- Trip details ---------------------------------------------------
  const fys = [...new Set(sorted.map(e => financialYear(e.date)).concat(trip.startDate ? [financialYear(trip.startDate)] : []))].sort();
  const details = [
    ['Claimant', settings.claimantName || '-'],
    ['Destination', trip.destination || '-'],
    ['Travel dates', trip.startDate ? `${fmtDate(trip.startDate)} to ${fmtDate(trip.endDate)} (${n} night${n === 1 ? '' : 's'})` : '-'],
    ['Purpose of travel', trip.purpose || '-'],
    ['Financial year', fys.join(', ') || '-'],
    ['Report generated', fmtDate(todayISO())],
  ];
  for (const [k, v] of details) {
    font('bold', 9, [107, 114, 128]); doc.text(k, M, y);
    font('normal', 10);
    const lines = doc.splitTextToSize(pdfText(v), W - 42);
    doc.text(lines, M + 42, y);
    y += Math.max(1, lines.length) * 4.3 + 1.2;
  }
  y += 2;

  // ---- Totals ---------------------------------------------------------
  const boxes = [
    ['Total (AUD)', $(sum.total)],
    ['GST included', $(sum.gst)],
    ['Reimbursed', $(sum.reimbursed)],
    ['Net, not reimbursed', $(sum.net)],
  ];
  const bw = (W - 9) / 4;
  boxes.forEach(([label, value], i) => {
    const x = M + i * (bw + 3);
    doc.setFillColor(240, 253, 250); doc.setDrawColor(153, 246, 228); doc.setLineWidth(0.3);
    doc.roundedRect(x, y, bw, 16, 2, 2, 'FD');
    font('normal', 7.5, [107, 114, 128]); doc.text(label.toUpperCase(), x + 3, y + 5);
    font('bold', 12); doc.text(value, x + 3, y + 12);
  });
  y += 22;

  // ---- By category ----------------------------------------------------
  heading('Summary by category');
  const catRows = CATEGORIES.filter(c => sum.byCat[c.id]).map(c => {
    const s = sum.byCat[c.id];
    const label = c.id === 'mileage' ? `${c.label} (${n2(sum.km)} km)` : c.label;
    return { cells: [label, String(s.count), $(s.aud), $(s.gst)] };
  });
  catRows.push({ bold: true, cells: ['Total', String(sum.count), $(sum.total), $(sum.gst)] });
  table([
    { h: 'Category', w: 100 }, { h: 'Items', w: 20, align: 'right' },
    { h: 'Amount (AUD)', w: 36, align: 'right' }, { h: 'GST (AUD)', w: 30, align: 'right' },
  ], catRows);

  // ---- Itemised ---------------------------------------------------------
  heading('Itemised expenses');
  const itemRows = sorted.map((e, i) => ({
    cells: [String(i + 1), fmtDate(e.date), CAT[e.category]?.label || e.category, descCell(e),
      paidCell(e), rateCell(e), n2(e.aud), e.gst ? n2(e.gst) : '', (refs[e.id] || []).join(' ') || '-'],
  }));
  itemRows.push({ bold: true, cells: ['', '', 'Total', '', '', '', n2(sum.total), n2(sum.gst), ''] });
  table([
    { h: '#', w: 7 }, { h: 'Date', w: 17 }, { h: 'Category', w: 24 }, { h: 'Description', w: 55 },
    { h: 'Paid', w: 25, align: 'right' }, { h: 'Rate', w: 15, align: 'right' },
    { h: 'AUD', w: 17, align: 'right' }, { h: 'GST', w: 13, align: 'right' }, { h: 'Receipt', w: 13 },
  ], itemRows);

  // ---- Notes ------------------------------------------------------------
  const notes = [];
  if (sum.foreign) notes.push('Foreign currency amounts are converted to AUD at the rate shown (AUD per 1 unit of the foreign currency), as entered by the claimant.');
  if (sum.km) notes.push(`Mileage uses the ATO cents per kilometre method at the rate shown per entry. Total for this trip: ${n2(sum.km)} km. The ATO caps this method at 5,000 business km per car per financial year, and the rate covers all running costs for that car (fuel, registration, insurance, servicing, depreciation).`);
  if (sum.reimbursed) notes.push('Items marked REIMBURSED were repaid by an employer or client. They are listed for completeness and are not claimable as a deduction.');
  notes.push('GST is shown only where it was recorded for Australian purchases.');
  heading('Notes');
  notes.forEach(t => paragraph('- ' + t));

  const warnings = reportWarnings(trip, sorted, diary);
  if (warnings.length) {
    heading('Record-keeping checks');
    warnings.forEach(t => paragraph('- ' + t, 9, [146, 64, 14]));
  }

  // ---- Travel diary -----------------------------------------------------
  if (diary.length) {
    heading('Travel diary');
    const d = [...diary].sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
    table([
      { h: 'Date', w: 20 }, { h: 'Start', w: 14 }, { h: 'End', w: 14 }, { h: 'Location', w: 45 }, { h: 'Activity', w: 93 },
    ], d.map(x => ({ cells: [fmtDate(x.date), x.startTime || '', x.endTime || '', x.location || '', x.activity || ''] })));
  }

  // ---- Receipts appendix -------------------------------------------------
  if (receipts.length) {
    newPage();
    heading(`Receipts (${receipts.length})`);
    const HALF = (BOTTOM - TOP) / 2 - 4;
    for (const { ref, r, e } of receipts) {
      const ratio = r.height / r.width;
      // Long, narrow receipts get a whole page so they stay legible.
      const tall = (HALF - 8) / ratio < W * 0.5;
      const maxH = tall ? BOTTOM - TOP - 24 : HALF - 8; // leaves room for the section heading
      let w = W, h = W * ratio;
      if (h > maxH) { h = maxH; w = h / ratio; }
      if (y + h + 8 > BOTTOM) newPage();
      font('bold', 9);
      const cap = `${ref}  |  ${fmtDate(e.date)}  |  ${CAT[e.category]?.label || ''}  |  ${e.description || ''}${e.vendor ? ' - ' + e.vendor : ''}  |  ${paidCell(e)}${e.currency !== 'AUD' && e.category !== 'mileage' ? ` (AUD ${n2(e.aud)})` : ''}`;
      doc.text(doc.splitTextToSize(pdfText(cap), W)[0], M, y + 4);
      const x = M + (W - w) / 2;
      doc.addImage(new Uint8Array(r.data), 'JPEG', x, y + 6, w, h, r.id, 'NONE');
      doc.setDrawColor(209, 213, 219); doc.setLineWidth(0.2); doc.rect(x, y + 6, w, h);
      y += h + 12;
    }
  }

  // ---- Footer -------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font('normal', 8, [156, 163, 175]);
    doc.text(pdfText(`Travel Diary - ${trip.name || ''}`), M, 291);
    doc.text(`Page ${i} of ${pages}`, M + W, 291, { align: 'right' });
  }
  return doc.output('blob');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv({ trip, expenses, receiptsByExpense }) {
  const sorted = sortExpenses(expenses);
  const { refs } = numberReceipts(sorted, receiptsByExpense);
  const header = ['#', 'Trip', 'Date', 'Financial year', 'Category', 'Description', 'Vendor', 'Payment method',
    'Currency', 'Amount', 'Exchange rate (AUD per unit)', 'Amount AUD', 'GST AUD', 'Km', 'Rate per km',
    'Vehicle', 'Odometer start', 'Odometer end', 'Reimbursed', 'Receipts', 'Notes'];
  const rows = sorted.map((e, i) => [
    i + 1, trip.name, e.date, financialYear(e.date), CAT[e.category]?.label || e.category, e.description, e.vendor,
    e.category === 'mileage' ? '' : e.paymentMethod, e.category === 'mileage' ? 'AUD' : e.currency,
    e.category === 'mileage' ? '' : round2(e.amount).toFixed(2),
    e.category === 'mileage' || e.currency === 'AUD' ? '' : e.rate,
    round2(e.aud).toFixed(2), e.gst ? round2(e.gst).toFixed(2) : '',
    e.category === 'mileage' ? e.km : '', e.category === 'mileage' ? e.kmRate : '',
    e.vehicle || '', e.odoStart || '', e.odoEnd || '', e.reimbursed ? 'Yes' : 'No',
    (refs[e.id] || []).join(' '), e.notes,
  ]);
  const sum = summarise(sorted);
  rows.push([]);
  rows.push(['', '', '', '', 'TOTAL', '', '', '', '', '', '', sum.total.toFixed(2), sum.gst.toFixed(2), sum.km || '']);
  const text = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
}
