# Anaesthesia Case Log

A personal, mobile-first case log for an anaesthetist: photograph a hospital
registration sheet, let OCR pull out the fields, review/correct, save. The
app automatically alternates the anaesthetist assignment per day, keeps a
daily log, calendar, monthly dashboard, "My Cases" view, consultant-wise
breakdown, search/filters, and month-end export to Excel/CSV/PDF.

It is **not** an EMR. There is no billing, pharmacy, nursing, or scheduling.
Everything is scoped to: photo → OCR → verify → assign anaesthetist → save →
daily log → monthly report.

## How it's built

A single static web app (HTML/CSS/vanilla JS) — no backend, no server,
no account. It installs to your phone's home screen as a Progressive Web
App (PWA) and works offline once loaded. All data stays on your device.

- OCR: [Tesseract.js](https://github.com/naptha/tesseract.js) (runs in the
  browser, on-device)
- Excel export: [SheetJS](https://sheetjs.com/)
- PDF export: [jsPDF](https://github.com/parallax/jsPDF) + autotable
- Storage: IndexedDB, with every record encrypted at rest with AES-256-GCM
  using a key derived from your PIN (PBKDF2, 150,000 rounds). The PIN
  itself is never stored — only a salt and a small "verifier" blob used to
  check a PIN attempt is correct.

## Getting it onto your phone

The app is a set of static files (`index.html`, `css/`, `js/`, etc.) — it
needs to be served over HTTPS for the camera, OCR, and installability to
work (opening `index.html` directly from disk will not work well on
mobile). Easiest free options:

1. **GitHub Pages** — create a repo, upload this folder's contents, enable
   Pages in the repo settings. You'll get a `https://<you>.github.io/...`
   URL.
2. **Netlify / Vercel (drag-and-drop)** — drag this folder onto
   netlify.com/drop (no account needed for a quick deploy) or import it as
   a project on Vercel.
3. Any other static host / your own web server.

Once it's live:

1. Open the URL in Chrome (Android) or Safari (iPhone).
2. Android Chrome: menu → **"Add to Home screen"** / **"Install app"**.
   iPhone Safari: Share button → **"Add to Home Screen"**.
3. Launch it from the home-screen icon from then on — it opens full-screen,
   works offline, and the camera/photo picker work like a native app.

## First run

- You'll be asked to create a PIN. This encrypts everything stored on the
  device. **There is no password recovery** — if you forget the PIN, the
  data cannot be decrypted. Write it down somewhere safe.
- Go to **Settings** and confirm/edit Anaesthetist 1 (you), Anaesthetist 2
  (Dr. Jagadeesh by default), Hospital and Location.

## Daily workflow

1. Tap **+ ADD CASE** → **TAKE PHOTO** (or **UPLOAD PHOTO** for an existing
   image).
2. OCR runs on-device and extracts patient name, age/sex, UHID, visit
   number, consultant, and date.
3. The **Review Case** screen shows the extracted fields, with **⚠ Verify**
   badges on anything OCR wasn't confident about. Edit as needed.
4. **Case Date** defaults to today; change it if the anaesthesia date
   differs from the document date — the anaesthetist sequence is
   recalculated for whichever date you pick.
5. The **Anaesthetist** field is pre-filled by the alternating sequence for
   that day (Case 1 → you, Case 2 → Dr. Jagadeesh, Case 3 → you, …,
   restarting fresh each day). You can override it for one case without
   disturbing the sequence for the next case that day.
6. **SAVE CASE**. If a possible duplicate is detected (same UHID, same
   visit number, or same patient name + date), you'll be asked to confirm
   before it's saved anyway.

## Where things live

- **Home** — today's snapshot + the big Add Case button.
- **Calendar** — tap any date to see that day's cases.
- **Dashboard** — monthly totals, per-anaesthetist split, working days,
  averages, and month-end export (Excel/CSV/PDF).
- **My Cases** — filter to just your cases (or Dr. Jagadeesh's, or all).
- **Search** — patient name, UHID, visit number, consultant, anaesthetist,
  hospital, location, date.
- **Settings** — roster/hospital/location, Backup/Restore, and Recently
  Deleted (soft-deleted cases can be restored here).

## Backup

Deletion is soft (recoverable from Settings). For real backups: Settings →
**Backup/Restore** → **BACKUP DATA** downloads a single encrypted JSON file
(still protected by your PIN — safe to store in your own cloud drive).
**RESTORE DATA** loads it back (on this device or a new one — you'll need
the same PIN it was backed up with).

## Privacy

- No server, no analytics, no account. Nothing patient-identifiable ever
  leaves the device.
- All case records and the registration-sheet photos are encrypted at rest
  (AES-256-GCM) using a key derived from your PIN.
- The three OCR/export libraries are loaded once from a public CDN
  (jsDelivr) the first time you open the app, then cached offline by the
  service worker — no patient data is ever sent to them or anywhere else.

## Project layout

```
index.html          App shell, loads libraries + modules
css/style.css        All styling
js/crypto.js          PIN-derived AES-GCM encryption
js/db.js               IndexedDB wrapper
js/parser.js           OCR text -> structured fields (+ confidence)
js/sequence.js          Per-day alternating anaesthetist assignment
js/duplicates.js        Pre-save duplicate detection
js/stats.js             Daily/monthly aggregation + insights
js/export.js            Excel (6-sheet) / CSV / PDF export
js/ocr.js               Tesseract.js wrapper
js/app.js               UI / screens / routing
manifest.json, sw.js  PWA install + offline caching
icons/                App icons
test/                 Unit tests (parser/sequence/duplicates/stats)
```

## Running the tests (optional, for future changes)

```
node test/test.js
```

This covers the pure logic: OCR-text parsing against the exact sample
sheet in the spec, per-day alternating assignment (including that a manual
override doesn't shift later cases), duplicate detection, and monthly
stats/insights. The full UI (screens, save/edit/delete, exports, PIN lock)
was verified end-to-end with a headless-browser run against this exact
code before delivery.

## What's deliberately not in v1

Procedure name, ASA grade, airway, regional block technique, complications,
ICU admission, duration, specialty — the database (`case_id`, `procedure`,
etc. — see `js/app.js`'s case object) has room for these, but v1 stays to:
photo → OCR → verify → assign anaesthetist → save → daily log → monthly
report, as requested.
