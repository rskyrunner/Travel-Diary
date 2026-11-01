# Travel Diary

An iPhone web app for logging travel costs as you go, attaching photos of receipts, and producing an expense report for an ATO tax claim.

- **Expenses:** flights, accommodation, meals, car hire, fuel, tolls and parking, mileage, taxis, public transport, conference fees, incidentals and other costs.
- **Receipts:** scan with the camera or add from Photos. Images are shrunk and contrast-enhanced so faded receipts stay readable.
- **Currencies:** enter the local amount plus the exchange rate, or the AUD amount from your card statement, and the rate is worked out for you. Every report total is in AUD.
- **GST:** record the GST on Australian purchases (the 1/11 button does the maths).
- **Mileage:** odometer start and end, or kilometres, at the ATO cents-per-km rate for that financial year.
- **Travel diary:** a log of work activities, which the ATO generally requires for trips of 6 or more nights in a row.
- **Reports:**
  - A PDF with trip details, totals by category, an itemised list, notes and the travel diary. Every receipt image is attached and numbered R1, R2… to match the itemised list.
  - A CSV file for Excel or Numbers.
- **Offline and private:** everything is stored on the phone. There is no account and no server.

## Put it on your iPhone

The app has to be served over HTTPS so it can install and work offline. The simplest option is GitHub Pages:

1. Merge this branch into `main`.
2. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**. The included workflow deploys every push to `main`.
3. Open the Pages address (for example `https://rskyrunner.github.io/travel-diary/`) in **Safari** on the iPhone.
4. Tap **Share → Add to Home Screen**.

Open it from the home-screen icon from then on. It works without signal.

> GitHub Pages on a **private** repository needs a paid GitHub plan. Otherwise, make the repository public (your data is never in the repository, only the app code), or host the same files on another static host such as Netlify or Cloudflare Pages.

## Using it

1. **New trip:** name, destination, dates and the work purpose.
2. **Add expense:** pick a category, enter the amount and tap **Scan receipt**. A row marked *no receipt* still needs one.
3. **Diary tab:** add an entry for each work activity (date, times, place, what you did).
4. **Report tab:** review the checks, then tap **PDF report with receipts** or **CSV spreadsheet**. The iOS share sheet opens, so you can save to Files, email your accountant or AirDrop the file.

Before your first mileage entry, open **Settings** to add your name (it appears on reports) and to check the cents-per-km rates.

## Back up your data

The data lives only in Safari's storage on the phone. If the app is deleted from the home screen, or the phone is lost, the data goes with it. Use **Settings → Export backup** regularly and save the file to iCloud Drive. **Restore from backup** brings it back on any device.

## ATO notes

- **Cents per km:** 88c/km for 2024–25 and 2025–26, capped at 5,000 business km per car per financial year. The rate covers all running costs for that car, so don't also claim its fuel. Later years have no default rate; enter it in Settings once the ATO publishes it.
- **Travel diary:** generally required if you're away 6 or more nights in a row.
- **Reimbursed costs:** items marked *Reimbursed* stay on the report for completeness but are excluded from the "Net, not reimbursed" total.

Sources: [ATO – cents per kilometre method](https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/work-related-deductions/cars-transport-and-travel/motor-vehicle-and-car-expenses/expenses-for-a-car-you-own-or-lease/cents-per-kilometre-method), [ATO – keeping travel expense records](https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/work-related-deductions/cars-transport-and-travel/overnight-travel-expenses-and-allowances/keeping-travel-expense-records). This app is a record-keeping tool, not tax advice.

## Development

The app is plain HTML, CSS and JavaScript with no build step. To run it locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

| File | Purpose |
| --- | --- |
| `js/app.js` | Screens and routing |
| `js/db.js` | IndexedDB storage, settings, backup and restore |
| `js/util.js` | Categories, formatting, totals and record-keeping checks |
| `js/image.js` | Receipt resizing and enhancement |
| `js/report.js` | PDF and CSV generation |
| `sw.js` | Offline cache. **Bump `VERSION` whenever you change any file**, or phones keep the old copy. |
| `vendor/jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 (MIT licence) |
