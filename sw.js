// Offline app shell. Patient data never passes through here: it lives only in IndexedDB.
const CACHE = 'anaesthesia-log-v8-0-0';
const SHELL = ['./', 'index.html', 'manifest.json', 'css/style.css',
  'js/crypto.js', 'js/keys.js', 'js/ui-security.js', 'js/ui-home.js', 'js/schema.js', 'js/db.js', 'js/backup.js', 'js/meddata.js', 'js/parser.js', 'js/sequence.js', 'js/duplicates.js', 'js/stats.js',
  'js/analytics.js', 'js/export.js', 'js/reports.js', 'js/ocr.js',
  'js/ui-common.js', 'js/ui-data.js', 'js/ui-case.js', 'js/ui-preop.js', 'js/ui-proc.js', 'js/ui-portfolio.js', 'js/ui-dash.js', 'js/ui-search.js', 'js/ui-reports.js',
  'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'];
self.addEventListener('install', (e) => {
  // One missing file must not stop the install: cache each file on its own.
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    await Promise.all(CDN.map((u) => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('cdn.jsdelivr.net'))) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match('index.html'))));
});
