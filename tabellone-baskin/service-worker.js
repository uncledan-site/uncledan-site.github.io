/* =====================================================================
   Service worker - Tabellone Baskin
   Cache-first per il funzionamento completamente offline.
   Aggiornare CACHE_NAME ad ogni rilascio per forzare l'aggiornamento.
   ===================================================================== */
const CACHE_NAME = 'baskin-tabellone-v1.13.1';

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './sounds/horn.wav',
  './sounds/whistle.wav',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/* messaggio dall'app: attiva subito la nuova versione in attesa */
self.addEventListener('message', (event)=>{
  if(event.data && event.data.type === 'SKIP_WAITING'){ self.skipWaiting(); }
});

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(res => {
        // memorizza in cache le richieste valide della stessa origine
        if(res && res.status === 200 && res.type === 'basic'){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(()=>{
        // fallback: per le navigazioni, restituisci la pagina principale
        if(req.mode === 'navigate'){ return caches.match('./index.html'); }
      });
    })
  );
});
