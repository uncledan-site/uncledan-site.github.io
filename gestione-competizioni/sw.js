// ══════════════════════════════════════════════════════════
// CONFIGURAZIONE — modificare qui per aggiornare il ramo
// ══════════════════════════════════════════════════════════
const SW_VERSION = '3.1';
// BASE calcolato dalla posizione reale di sw.js — funziona a qualsiasi
// percorso di pubblicazione e a qualsiasi profondità di cartelle:
// dominio radice, sottocartella singola, nidificata, con o senza cartella
// "pwa"/"pwa-beta" intermedia. Nessuna assunzione sulla struttura esterna.
const BASE = new URL('.', self.location).href;
const CACHE_NAME = `gestione-competizioni-sw-${SW_VERSION}`;

const PRECACHE = [
  BASE,
  `${BASE}index.html`,
  `${BASE}finali.html`,
  `${BASE}manifest.json`,
  `${BASE}versions.json`,
  `${BASE}icon.svg`,
];

const FONT_CACHE = `gestione-competizioni-fonts-1`;
const FONT_ORIGINS = ['https://fonts.googleapis.com','https://fonts.gstatic.com'];

// versions.json sempre fresh (no cache)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Font Google: cache-first con fallback rete → offline i font funzionano
  if (FONT_ORIGINS.some(o => e.request.url.startsWith(o))) {
    e.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(e.request).then(hit =>
          hit || fetch(e.request).then(resp => {
            if (resp.ok) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => hit)
        )
      )
    );
    return;
  }

  if (!e.request.url.startsWith(self.location.origin)) return;

  if (e.request.url.includes('/versions.json')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Strategia network-first: prova rete, aggiorna cache, fallback a cache
  // Il cambio di CACHE_NAME ad ogni versione garantisce file aggiornati dopo skipWaiting
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Pre-cache "best effort": ogni file viene messo in cache singolarmente.
      // Se uno fallisse (rete instabile, file assente), non blocca l'installazione
      // degli altri né l'attivazione del Service Worker.
      Promise.all(PRECACHE.map(url =>
        cache.add(url).catch(err => console.warn('[SW] precache fallita:', url, err))
      ))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== FONT_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
