// Camera barcode scanning. iOS Safari has no native BarcodeDetector, so the
// zxing-wasm based ponyfill is loaded from a CDN on first use. Scans made
// offline are queued in IndexedDB and looked up later.

import { toIsbn13 } from './lib/isbn.js';

const PONYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/es/ponyfill.js/+esm';
let DetectorClass = null;

async function detectorClass() {
    if (DetectorClass) return DetectorClass;
    if ('BarcodeDetector' in window) {
        try {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if (formats.includes('ean_13')) return (DetectorClass = window.BarcodeDetector);
        } catch { /* fall through to the ponyfill */ }
    }
    const mod = await import(PONYFILL);
    return (DetectorClass = mod.BarcodeDetector);
}

/**
 * Start scanning into `video`. Calls onIsbn(isbn13) once per distinct book
 * barcode. Returns { stop(), setTorch(on), torchSupported }.
 */
export async function startScanner(video, { onIsbn, onError }) {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('This browser cannot use the camera.'), { code: 'no_camera_api' });
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const Detector = await detectorClass();
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    let stopped = false;
    let last = null, lastAt = 0;

    const tick = async () => {
        if (stopped) return;
        try {
            if (video.readyState >= 2) {
                const codes = await detector.detect(video);
                for (const c of codes) {
                    const isbn = toIsbn13(c.rawValue);
                    if (!isbn) continue;
                    if (isbn === last && Date.now() - lastAt < 4000) continue;
                    last = isbn; lastAt = Date.now();
                    navigator.vibrate?.(30);
                    onIsbn(isbn);
                }
            }
        } catch (e) { onError?.(e); }
        if (!stopped) setTimeout(() => requestAnimationFrame(tick), 180);
    };
    tick();

    return {
        torchSupported: !!caps.torch,
        async setTorch(on) {
            if (caps.torch) await track.applyConstraints({ advanced: [{ torch: !!on }] });
        },
        stop() {
            stopped = true;
            stream.getTracks().forEach((t) => t.stop());
            video.srcObject = null;
        },
    };
}

// ─── Offline queue ──────────────────────────────────────────────────
const DB = 'bt-scan-queue';
function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('isbns', { keyPath: 'isbn' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
        const t = db.transaction('isbns', mode);
        const result = fn(t.objectStore('isbns'));
        t.oncomplete = () => resolve(result?.result ?? result);
        t.onerror = () => reject(t.error);
    });
}

export const queue = {
    add: (isbn, reason = 'offline') => tx('readwrite', (s) => s.put({ isbn, reason, queuedAt: new Date().toISOString() })),
    remove: (isbn) => tx('readwrite', (s) => s.delete(isbn)),
    async list() {
        try { return await tx('readonly', (s) => s.getAll()); } catch { return []; }
    },
};
