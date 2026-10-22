import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

// index.html preloads every module so the browser fetches them in parallel
// instead of discovering them one import level at a time. Keep it complete.

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

function staticImports(file) {
    const src = read(file);
    return [...src.matchAll(/^\s*import\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)]
        .map((m) => normalize(join(dirname(file), m[1])));
}

function moduleGraph(entry) {
    const seen = new Set();
    const walk = (f) => { if (seen.has(f)) return; seen.add(f); staticImports(f).forEach(walk); };
    walk(entry);
    return seen;
}

const preloads = [...read('index.html').matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);

test('index.html preloads exactly the modules app.js loads at start', () => {
    const expected = new Set([...moduleGraph('js/app.js'), 'js/firebase.js']);
    const local = new Set(preloads.filter((h) => !h.startsWith('http')));
    assert.deepEqual([...expected].filter((f) => !local.has(f)), [], 'missing from index.html');
    assert.deepEqual([...local].filter((f) => !expected.has(f)), [], 'preloaded but no longer imported');
});

test('preloaded Firebase SDK matches the version js/firebase.js imports', () => {
    const version = /const V = '([^']+)'/.exec(read('js/firebase.js'))[1];
    const sdk = preloads.filter((h) => h.includes('firebasejs'));
    assert.equal(sdk.length, 3);
    for (const h of sdk) assert.ok(h.includes(`/firebasejs/${version}/`), `${h} is not version ${version}`);
});
