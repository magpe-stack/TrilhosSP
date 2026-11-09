/* ==========================================================================
 * SP Trilhos - Service Worker (sw.js)
 * Cache estático + funcionamento 100% offline.
 *  - Instalação: pré-carrega o "app shell" e os dois ativos pesados (JSON + SVG).
 *  - Navegação: network-first com fallback para o index.html em cache.
 *  - Demais GET do mesmo domínio: cache-first com revalidação em segundo plano.
 * Para publicar uma nova versão, incremente VERSAO.
 * ========================================================================== */
'use strict';

const VERSAO = 'sptrilhos-v1.0.0';
const NUCLEO = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './dados.json',
  './mapa.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then((cache) => cache.addAll(NUCLEO))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // links externos passam direto

  // Navegação (abrir o app): rede primeiro, cache como reserva (offline).
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put('./index.html', copia));
          return resp;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Recursos estáticos: cache primeiro, atualiza em segundo plano.
  evento.respondWith(
    caches.match(req).then((emCache) => {
      const rede = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(VERSAO).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => emCache);
      return emCache || rede;
    })
  );
});
