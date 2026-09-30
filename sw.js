/*
 * Anaesthesia Log
 * Service Worker
 *
 * Provides:
 * - Offline app shell
 * - Faster loading
 * - PWA functionality
 *
 * Patient data is NOT stored in this cache.
 * Patient data remains in IndexedDB.
 */

const CACHE_NAME = 'anaesthesia-log-shell-v2';


/* =========================================================
   APPLICATION FILES
   ========================================================= */

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './style.css',

  /* JavaScript modules */
  './crypto.js',
  './db.js',
  './parser.js',
  './sequence.js',
  './duplicates.js',
  './stats.js',
  './export.js',
  './ocr.js',
  './app.js',

  /* PWA icons */
  './icon-192.png',
  './icon-512.png'
];


/* =========================================================
   INSTALL
   ========================================================= */

self.addEventListener('install', (event) => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then((cache) => {

        return cache.addAll(SHELL_FILES);

      })

  );

  /*
   * Activate the new worker immediately.
   */

  self.skipWaiting();

});


/* =========================================================
   ACTIVATE
   ========================================================= */

self.addEventListener('activate', (event) => {

  event.waitUntil(

    caches.keys()
      .then((cacheNames) => {

        return Promise.all(

          cacheNames
            .filter((cacheName) => {
              return cacheName !== CACHE_NAME;
            })
            .map((cacheName) => {
              return caches.delete(cacheName);
            })

        );

      })

  );

  /*
   * Take control of open pages immediately.
   */

  self.clients.claim();

});


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener('fetch', (event) => {

  /*
   * Only handle GET requests.
   */

  if (event.request.method !== 'GET') {
    return;
  }


  const request = event.request;


  event.respondWith(

    caches.match(request)

      .then((cachedResponse) => {

        /*
         * If the file is already cached,
         * use the cached version.
         */

        if (cachedResponse) {
          return cachedResponse;
        }


        /*
         * Otherwise fetch from network.
         */

        return fetch(request)

          .then((networkResponse) => {

            /*
             * Only cache successful responses.
             */

            if (
              !networkResponse ||
              networkResponse.status !== 200
            ) {

              return networkResponse;

            }


            /*
             * Store a copy in cache.
             */

            const responseClone =
              networkResponse.clone();


            caches.open(CACHE_NAME)
              .then((cache) => {

                cache.put(
                  request,
                  responseClone
                );

              });


            return networkResponse;

          })

          .catch(() => {

            /*
             * If network fails, try cache.
             */

            return caches.match(request);

          });

      })

  );

});