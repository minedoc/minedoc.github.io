const cacheName = 'offline_files';
const precachedAssets = [
  '/',
  '/index.css',
  '/diff.js',
  '/main.js',
  '/database.js',
  '/lib.js',
  '/ref.js',
  '/changes.js',
  '/share.js',
  '/types.js',
  '/util.js',
  '/bloomfilter.js',
  '/discovery.js',
  '/stub.js',
  '/binary.js',
  '/manifest.json',
  '/site-icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(precachedAssets)));
});

self.addEventListener('fetch', event => {
  const path = new URL(event.request.url).pathname;
  if (precachedAssets.includes(path)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(path)));
  }
});