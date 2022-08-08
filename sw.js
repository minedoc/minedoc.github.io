const cacheName = 'offline_files';
const precachedAssets = [
  '/',
  '/index.css',
  '/diff.js',
  '/main.js',
  '/lib.js',
  '/ref.js',
  '/serverless2/database.js',
  '/serverless2/changes.js',
  '/serverless2/share.js',
  '/serverless2/types.js',
  '/serverless2/util.js',
  '/serverless2/bloomfilter.js',
  '/serverless2/discovery.js',
  '/serverless2/stub.js',
  '/serverless2/binary.js',
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
