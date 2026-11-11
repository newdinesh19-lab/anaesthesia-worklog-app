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
  using a key derived from your PIN (PBKDF2; 310,000 rounds for PINs set in V8, 150,000 kept for older ones so existing data opens unchanged). The PIN
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

---
## v4 — Night duty & notable cases
- **Night duty button (Home):** one tap marks tonight (before 08:00 it marks the previous evening) on the calendar with a moon. Tap again to edit hospital, location, from/to times, notes, or remove. Also available per-day via "Mark night duty".
- **Sick / interesting case:** toggle in the case form with type (difficult airway, critical, complication, rare, learning point) and a note. ★ badge on cards and calendar, ★ Notable filter, Reports list, and a NOTABLE CASES Excel sheet.
- Night duties are encrypted, included in backup/restore and PIN change, and exported as a NIGHT DUTIES sheet. Local DB upgraded to v2 (existing data kept).
- Update: open the app once online so the new service worker (cache v4) installs.

## v5 — Pre-op tab
- New **Pre-op** tab: photo of the pre-op assessment chart (encrypted) plus structured entry: ASA, fitness, conditions and medicines from dropdown lists (insulin, metformin, antihypertensives, anticoagulants, inhalers, anti-epileptics and more), allergies, airway exam with difficult-airway flags, difficulties, vitals and notes. Medicines that usually need a plan (SGLT2i, anticoagulants, antiplatelets, ACEi/ARB, steroids…) show a review prompt.
- THANC Hospital and Yaal Hospital added to the hospital list, now managed in Settings → Hospitals, with one-tap chips in cases, night duty and pre-op.
- Pre-op data is included in backup/restore and PIN change. Local DB upgrades to v3.


## v8 — Portfolio, procedures, analytics, reports, data safety

**Upgrading from v7 is safe.** The database moves from version 3 to 4 by *adding* storage areas only
(procedures, templates). Nothing is deleted or rewritten; older cases/pre-ops are upgraded in memory when
read and are only re-saved (as schema 8) when you edit them. A safety backup is offered before the first V8 open.

What's new
- **Case form:** Quick / Detailed modes; multiple techniques per case; ASA (with E), urgency, speciality (suggested, never forced), complexity; airway, intra-op, post-op sections; templates.
- **Pre-op:** all systems, functional capacity, investigations, medication/antithrombotic review, multiple photos. It never decides fitness for you.
- **Procedures:** 15 procedure types with role, attempts, outcome, supervisor, complications; month / year / all-time counts; quick-log from a case; templates.
- **Portfolio:** 13 categories (Paediatric and Geriatric overlap surgical speciality; thresholds in Settings), per-category ASA / technique / complexity.
- **Analytics:** date-range filters (incl. financial year Apr–Mar), workload, case mix, consultants/hospitals, interactive charts. These are personal workload figures, **not quality-of-care indicators**.
- **Reports:** 8 types × PDF / Excel (one worksheet per table) / CSV. De-identified by default; identifiers are opt-in with a warning. Excel has no embedded charts (PDF does).
- **Search:** across cases, pre-ops, procedures, duties.
- **Safety:** persistent PIN lockout with back-off, auto-lock, backup file with checksum + restore preview, atomic restore, corrupted-record isolation, recycle bin (cases, pre-ops, procedures), data-health check, backup reminder, graded duplicate warnings, clear warning if the browser cannot store data (private mode).
- **Theme:** Auto / Light / Dark in Settings.

Important limits: PIN + encryption protect data *inside the app only*. Exported files and backups copied elsewhere are your responsibility. Using this app does not by itself make you compliant with any regulation. **If you forget your PIN the data cannot be recovered** — restore from a backup (which needs the PIN it was made with) or erase.

Tests: `node test/test.js` (28 unit tests). Browser tests used Playwright against a real v7 profile (migration, core, forms, procedures/portfolio, reports, offline).

## v8.1 — PIN recovery and fingerprint unlock

Settings → Security → **Recovery & fingerprint**.

- **Why no emailed reset link:** the app has no server, and your data is encrypted with a key that never leaves the phone. A link could not unlock it. Anything that claimed to would have to store the key somewhere it could be taken.
- **Recovery code (recommended):** a 20-character code (100 bits). Opens your data if the PIN is forgotten, then lets you set a new PIN. "Email it to me" only opens a draft in your own mail app (default address newdinesh19@yahoo.com, editable); nothing is sent by the app. A code kept in email is only as safe as that mailbox.
- **Security questions (optional, weaker):** two answers are required. Guessable by someone who knows you; an attacker with a copy of your data could try guesses offline. The code is safer.
- **Fingerprint unlock:** uses the phone's fingerprint/screen lock via WebAuthn. Where the phone supplies a secret (PRF) the data key is wrapped by it (strong). Otherwise the app offers a clearly labelled *convenience mode* (a non-extractable key on the phone behind the fingerprint prompt). Needs the app opened from its https address (not an IP address). Never included in backups, so set it up again after restoring.
- **How it works:** one random data key encrypts all records; it is stored wrapped separately by the PIN, the recovery code, the answers and the fingerprint. Changing the PIN only re-wraps it. Turning on recovery/fingerprint for an existing database rotates the data key once, atomically (everything changes or nothing does). Like any such scheme, someone who knows an *old* PIN and holds an *old* copy of the key wrapper could still open the same data key; treat a suspected PIN leak as a reason to make a fresh install and restore.
- Backups made in this mode still need a PIN that was valid when they were made (or the recovery code).

## v9 — Clinical UI redesign

Navy / royal blue / teal / coral / purple palette, flat white cards with soft shadows, Inter (falls back to the system font offline), light and dark themes (Settings → Theme).
- **Home** (`js/ui-home.js`): header with greeting, date, search, notification bell (real alerts: overdue backup, incomplete entries, unreadable records, no recovery set up), lock and profile/settings; statistic cards (cases this month, today, night duties, pending entries, procedures, anaesthesia hours when start/end times exist); quick actions (Add New Case, Scan Sheet, My Cases, Pre-op); analytics (weekly activity, 6-month trend, anaesthetist split, technique, elective vs emergency) shown only when data exists; recent cases as cards on phones and a table on desktop.
- **"Pending entries"** = cases missing surgery, ASA or technique. **Day duties** are not shown because the app only records night duties.
- **Navigation:** bottom bar on phones (never overlaps content); left sidebar from 900 px wide.
- Subtle hover/press feedback, counting statistics (off for reduced-motion users), button spinner while the PIN is checked.
- Inter is not bundled (no internet fetch at build time); add `fonts/Inter.woff2` and an `@font-face` if you want it offline.

## Schedule & reminders (v9.1)

- **Home → Plan a case** (below Night duty) and **More → Schedule**: record an upcoming/planned case with date, start/end time, hospital, location/theatre, surgery, consultant, anaesthetist, urgency, techniques, optional patient/UHID and notes.
- Status: planned / done / cancelled. "Start case" converts a plan into a case-log entry with fields pre-filled. Overlapping plans show a warning.
- **Reminders** (default 1 hour and 1 day before; also at start, 15 min, 3 h): shown as in-app alerts (bell) and as system notifications when permission is granted.
- **Limits (honest):** a PWA with no server cannot wake itself when fully closed. In-app/system alerts fire while the app is open or recently used. For guaranteed alerts when the app is closed, use **Add to calendar (.ics)** – it contains alarms for your phone calendar.
- Plans are stored encrypted in the existing `templates` store (type `plan`), so backup, restore and PIN change include them. No schema change.
- **Home-screen colour/icon:** the installed app caches its manifest; if the old green strip persists, remove and re-add the app to home screen (data is kept – same origin).

## v9.2
- Lock screen no longer auto-opens the keyboard. Pull-down on Android no longer reloads/re-locks the app. Home refreshes at midnight and 8am. Before 8am the night-duty card says "last night’s duty" with a "Mark tonight instead" option.

## v9.3 — THANC Duty Tracker
- **Home:** "THANC — Today's duty" sits under the Night duty card: Morning (default Dr. Dinesh + Dr. Arafath, 08:00–14:00), Evening (assign doctors, 14:00–20:00) and Night (default Dr. Karthik + Dr. Vignesh, 20:00–08:00). One tap marks a shift with its defaults; tap a card to expand (date, shift, start/end time pickers, doctors, notes, Save). Add other doctors by typing a name; remove with ×. **SAVE TODAY'S DUTY** saves every pending shift. Use ‹ › to enter another day.
- **More → THANC Duty:** monthly calendar with coloured dots (amber morning, teal evening, purple night), day details with Edit, Summary (monthly totals and doctor-wise Morning/Evening/Night counts), History with search by doctor or date, CSV and Excel export.
- **Storage:** encrypted `templates` store, record type `thanc`, one record per date + shift (`dutyId`, `hospital: THANC`, `date`, `shiftType`, `assignedDoctors`, `startTime`, `endTime`, `notes`, `createdAt`, `updatedAt`). No database version change; included in backup, restore and PIN change. Kept entirely separate from patient cases and from the personal Night duty feature. Changing the default doctors never alters saved duties.
- **Limits:** the personal "Night duty" button and THANC duties are separate records. Excel export needs the SheetJS library to have loaded once online (CSV always works).

## v9.4
- Removed the Home "Night duty" button (and "Mark tonight instead"); THANC duty replaces it. Old night-duty records stay stored and visible in Cases → Calendar and in exports. The Home "Night duties" tile is now "THANC duties" (shifts this month).
- Floating scroll button (down/up) on long screens; "Back" link on the Add/Pre-op/Procedure/Plan forms; Back on Reports.

## v9.5
- Collapsible Home sections (THANC duty, Planned cases, This month, Analytics, Recent cases). The open/closed choice is remembered on this phone; a one-line summary shows when closed.
- THANC shifts that are saved collapse to one compact row (time + doctors); tap a row to expand and edit.

## v10.0.0 — Duty management + photo editor

**THANC duty analytics (Cases → Calendar → THANC tabs: Calendar · Analytics · History · Doctors · Data)**
- Morning/Evening/Night counts per doctor, totals, month / quarter / calendar year (Financial Year Apr–Mar switch), highest/lowest, one doctor or all.
- Hours come only from recorded start/end times (per-doctor overrides supported). End earlier than start = overnight; end = start is invalid; missing/invalid times are flagged, never guessed.
- A duty counts once in the month it starts; its hours are split at midnight between calendar months.
- Defaults: Morning = Dr. Dinesh + Dr. Arafath; Night = all four (one tap). Doctors can be added, deactivated, merged. Every edit is audit-logged; deletes are soft (restorable).
- Data tab: preview-then-import of old personal night duties marked THANC (as Dr. Dinesh), duplicate-safe, with batch rollback. Nothing is deleted or overwritten.
- Exports: PDF, Excel, CSV (summary + line-level + audit).

**Photo editor (offline)** — shown after every camera/upload in Add Case, extra case pages and Pre-op photos: rotate ±90°, crop (drag handles), brightness, contrast, reset, preview, "Use original", cancel. EXIF orientation is corrected automatically; output is JPEG (long side ≤ 2400 px, quality 0.9, PNG/transparent → white background). The picked file is never modified; OCR runs on the edited image.
- A case can hold several pages (first page = OCR source; "Add page" in review/edit). Gallery: Case → Photo.
- Saved photos can be rotated/edited later (Rotate left/right/Edit) — only after an explicit "Replace photo" confirmation. The replaced version is **not** kept.

Schema: no IndexedDB version change. New optional fields: `case.photos[]` (extra image keys `caseId:xxxxxxxx`), THANC v2 record fields. Older data and backups remain readable.

Limits: not tested on a physical Android device (Chromium emulation only); very large photos are downscaled to 2400 px.

## v10.1.0 — Doctor colours, calendar filters, agenda
- **Permanent doctor colours**: stored against a permanent doctor id (`settings.thanc.docs [{id,name,color}]`), never the name. Defaults: Karthik #2563EB, Vignesh #0D9488, Dinesh #D97706, Arafath #8B5CF6. New doctors get an unused, distinguishable colour (generated when the palette runs out); change it in Doctors → Manage (colour picker; near-duplicates are refused). Colours survive deactivation and renaming (a rename keeps id, colour and all history; the old spelling becomes an alias).
- Calendar dots, duty cards, analytics, history, doctors list and PDF/CSV exports use the doctor colour (Excel/CSV carry a **Colour** hex column; SheetJS community edition cannot fill cells). Shifts stay identifiable by icon + label.
- Calendar: Month/Agenda views, doctor + shift filters (combine, Clear), doctor legend, monthly workload summary, duration on each duty card.
- Saving a **new** duty asks you to confirm who actually worked (pre-selection is only a suggestion).
