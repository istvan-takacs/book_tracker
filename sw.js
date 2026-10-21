// Service worker: caches the app shell (network-first, so updates land on the
// next open) and book covers (cache-first). No notifications by design.
// Bump VERSION when shipping changes to the shell.

const VERSION = 'v4';
const SHELL = `bt-shell-${VERSION}`;
const COVERS = 'bt-covers-v1';
const MAX_COVERS = 400;

const SHELL_FILES = [
    './', 'index.html', 'style.css', 'config.js', 'manifest.json', 'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png',
    'js/app.js', 'js/ui.js', 'js/cache.js', 'js/keyboard.js', 'js/store.js', 'js/api.js', 'js/actions.js', 'js/components.js', 'js/services.js', 'js/releases.js', 'js/scanner.js', 'js/sample.js', 'js/firebase.js',
    'js/lib/text.js', 'js/lib/isbn.js', 'js/lib/dates.js', 'js/lib/merge.js', 'js/lib/normalize.js', 'js/lib/search.js', 'js/lib/stats.js', 'js/lib/goodreads.js', 'js/lib/calendar.js', 'js/lib/follow.js', 'js/lib/progress.js', 'js/lib/moods.js', 'js/lib/rateLimiter.js',
    'js/views/home.js', 'js/views/library.js', 'js/views/search.js', 'js/views/scan.js', 'js/views/upcoming.js', 'js/views/stats.js', 'js/views/settings.js', 'js/views/onboarding.js', 'js/views/book.js', 'js/views/author.js', 'js/views/series.js',
    'js/sheets/progress.js', 'js/sheets/rate.js', 'js/sheets/releaseDate.js', 'js/sheets/seriesRead.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bt-') && k !== SHELL && k !== COVERS).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

const isCover = (url) => /covers\.openlibrary\.org|books\.google\.com\/books\/content|assets\.hardcover\.app|storage\.googleapis\.com\/hardcover/.test(url.href);

async function trimCovers() {
    const cache = await caches.open(COVERS);
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COVERS))) await cache.delete(k);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === location.origin) {
        // app shell: network first, cached copy offline
        event.respondWith(fetch(req).then((res) => {
            if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
            return res;
        }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
        return;
    }

    if (req.destination === 'image' && isCover(url)) {
        event.respondWith(caches.open(COVERS).then(async (cache) => {
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trimCovers(); }
            return res;
        }).catch(() => fetch(req)));
    }
    // Everything else (APIs, Firebase, fonts) goes straight to the network.
});
