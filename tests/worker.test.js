import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, hardcoverAuthHeader } from '../worker/src/index.js';
import { verifyIdToken } from '../worker/src/firebaseAuth.js';
import { signJwt } from '../worker/src/jwt.js';
import { validateVariables } from '../worker/src/queries.js';
import { decodeFields } from '../worker/src/firestore.js';

const PROJECT = 'book-tracker-test';
const NOW = Date.UTC(2026, 9, 19, 12);
const env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_UIDS: 'me-123', ALLOWED_ORIGINS: 'http://localhost:8000', HARDCOVER_TOKEN: 'hc-secret' };

let keys, privateKey, otherPrivate;
before(async () => {
    const alg = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    const pair = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
    const other = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
    privateKey = pair.privateKey;
    otherPrivate = other.privateKey;
    keys = { k1: await crypto.subtle.exportKey('jwk', pair.publicKey) };
});

const t = Math.floor(NOW / 1000);
const claims = (over = {}) => ({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'me-123', iat: t - 60, exp: t + 3000, auth_time: t - 60, ...over });
const token = (over, key = privateKey, kid = 'k1') => signJwt(claims(over), key, { kid });

function fakeHardcover(status = 200, body = { data: { search: { results: { hits: [] } } } }) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { calls, fetchImpl };
}

function memoryCache() {
    const m = new Map();
    return {
        async match(req) { const r = m.get(req.url); return r ? r.clone() : undefined; },
        async put(req, res) { m.set(req.url, res.clone()); },
    };
}

const post = (op, idToken, variables = { q: 'mistborn', n: 5 }, origin = 'http://localhost:8000') =>
    new Request(`https://w.example/q/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}), ...(origin ? { origin } : {}) },
        body: JSON.stringify({ variables }),
    });

test('ID token verification accepts a valid token and rejects bad ones', async () => {
    const opts = { projectId: PROJECT, getKeys: async () => keys, now: NOW };
    assert.equal(await verifyIdToken(await token(), opts), 'me-123');
    await assert.rejects(verifyIdToken(await token({ exp: t - 3600 }), opts), /expired/);
    await assert.rejects(verifyIdToken(await token({ aud: 'other' }), opts), /wrong_audience/);
    await assert.rejects(verifyIdToken(await token({ iss: 'https://evil' }), opts), /wrong_issuer/);
    await assert.rejects(verifyIdToken(await token({}, otherPrivate), opts), /bad_signature/);
    await assert.rejects(verifyIdToken(await token({}, privateKey, 'nope'), opts), /unknown_key/);
    await assert.rejects(verifyIdToken('not.a.jwt', opts), /malformed_token/);
});

test('queries need a valid sign-in from an allowed user', async () => {
    const hc = fakeHardcover();
    const handle = createHandler({ fetchImpl: hc.fetchImpl, getKeys: async () => keys, now: () => NOW });
    assert.equal((await handle(post('searchBooks', null), env)).status, 401);
    assert.equal((await handle(post('searchBooks', await token({ exp: t - 9999 })), env)).status, 401);
    assert.equal((await handle(post('searchBooks', await token({ sub: 'someone-else' })), env)).status, 403);
    assert.equal(hc.calls.length, 0, 'Hardcover never called for rejected requests');
});

test('a forged Origin is rejected even with a valid token', async () => {
    const hc = fakeHardcover();
    const handle = createHandler({ fetchImpl: hc.fetchImpl, getKeys: async () => keys, now: () => NOW });
    const res = await handle(post('searchBooks', await token(), undefined, 'https://evil.example'), env);
    assert.equal(res.status, 403);
    assert.equal(hc.calls.length, 0);
});

test('only allowlisted operations with valid variables run', async () => {
    const hc = fakeHardcover();
    const handle = createHandler({ fetchImpl: hc.fetchImpl, getKeys: async () => keys, now: () => NOW });
    const good = await token();
    assert.equal((await handle(post('deleteAccount', good), env)).status, 404);
    assert.equal((await handle(post('searchBooks', good, { q: 'x', n: 500 }), env)).status, 400);
    assert.equal((await handle(post('searchBooks', good, { q: 'x', n: 5, query: 'mutation { x }' }), env)).status, 400);
    const ok = await handle(post('searchBooks', good), env);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:8000');
    assert.equal(hc.calls.length, 1);
    const sent = JSON.parse(hc.calls[0].init.body);
    assert.match(sent.query, /^query searchBooks/);
    assert.equal(hc.calls[0].init.headers.authorization, 'Bearer hc-secret');
});

test('responses are cached per operation and variables', async () => {
    const hc = fakeHardcover();
    const handle = createHandler({ fetchImpl: hc.fetchImpl, getKeys: async () => keys, now: () => NOW, cache: memoryCache() });
    const good = await token();
    const a = await handle(post('searchBooks', good), env);
    const b = await handle(post('searchBooks', good), env);
    assert.equal(a.headers.get('x-cache'), 'miss');
    assert.equal(b.headers.get('x-cache'), 'hit');
    assert.equal(hc.calls.length, 1);
});

test('Hardcover failures become explainable errors', async () => {
    const good = await token();
    for (const [status, expected, code] of [[401, 503, 'hardcover_token'], [429, 429, 'rate_limited'], [500, 502, 'hardcover_unavailable']]) {
        const hc = fakeHardcover(status, { error: 'x' });
        const res = await createHandler({ fetchImpl: hc.fetchImpl, getKeys: async () => keys, now: () => NOW })(post('searchBooks', good), env);
        assert.equal(res.status, expected);
        assert.equal((await res.json()).error, code);
    }
    const noToken = await createHandler({ fetchImpl: fakeHardcover().fetchImpl, getKeys: async () => keys, now: () => NOW })(post('searchBooks', good), { ...env, HARDCOVER_TOKEN: '' });
    assert.equal((await noToken.json()).error, 'hardcover_token');
});

test('variable validation', () => {
    assert.equal(validateVariables('authorBooks', { ids: [1, 2], since: '2026-09-19', year: 2026 }), null);
    assert.match(validateVariables('authorBooks', { ids: [], since: '2026-09-19', year: 2026 }), /ids/);
    assert.match(validateVariables('editionByIsbn', { isbn13: '978', isbn10: '0765326353' }), /isbn13/);
});

test('calendar feed: unknown tokens 404, known tokens serve an ICS', async () => {
    const saPem = await (async () => {
        const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
        const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
        return `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`;
    })();
    const calEnv = { ...env, FIREBASE_SA_EMAIL: 'sa@x.iam.gserviceaccount.com', FIREBASE_SA_KEY: saPem };
    const goodToken = 'a'.repeat(40);
    const fetchImpl = async (url) => {
        if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', expires_in: 3600 });
        if (url.includes(`calendarTokens/${goodToken}`)) return Response.json({ fields: { uid: { stringValue: 'me-123' } } });
        if (url.includes('calendarTokens/')) return new Response('{}', { status: 404 });
        if (url.includes('/users/me-123/books')) return Response.json({ documents: [
            { name: 'x/books/hc_9', fields: { title: { stringValue: 'Tidewright' }, status: { stringValue: 'upcoming' }, releaseDate: { stringValue: '2026-10-22' }, datePrecision: { stringValue: 'day' }, authors: { arrayValue: { values: [{ mapValue: { fields: { name: { stringValue: 'Ines Vahl' } } } }] } } } },
            { name: 'x/books/hc_10', fields: { title: { stringValue: 'Read already' }, status: { stringValue: 'read' }, releaseDate: { stringValue: '2026-10-25' }, datePrecision: { stringValue: 'day' } } },
        ] });
        throw new Error('unexpected ' + url);
    };
    const handle = createHandler({ fetchImpl, now: () => NOW });
    assert.equal((await handle(new Request('https://w.example/cal/short.ics'), calEnv)).status, 404);
    assert.equal((await handle(new Request(`https://w.example/cal/${'b'.repeat(40)}.ics`), calEnv)).status, 404);
    const res = await handle(new Request(`https://w.example/cal/${goodToken}.ics`), calEnv);
    assert.equal(res.status, 200);
    const ics = await res.text();
    assert.match(ics, /SUMMARY:Tidewright \(Ines Vahl\) is out/);
    assert.match(ics, /UID:hc_9@book-tracker/);
    assert.doesNotMatch(ics, /Read already/);
});

test('Firestore value decoding', () => {
    assert.deepEqual(decodeFields({ a: { integerValue: '3' }, b: { mapValue: { fields: { c: { booleanValue: true } } } }, d: { nullValue: null } }), { a: 3, b: { c: true }, d: null });
});

test('Hardcover token paste mistakes are tolerated', () => {
    for (const t of ['abc123', ' abc123\n', '"abc123"', "'abc123'", 'Bearer abc123', '"Bearer abc123"', 'bearer  abc123']) {
        assert.equal(hardcoverAuthHeader(t), 'Bearer abc123', JSON.stringify(t));
    }
});

test('Hardcover errors carry its reason, never the token', async () => {
    const good = await token();
    const hc = fakeHardcover(401, { error: 'invalid_token', error_description: 'Token expired' });
    const res = await createHandler({ fetchImpl: hc.fetchImpl, getKeys: async () => keys, now: () => NOW })(post('searchBooks', good), env);
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.match(body.detail, /invalid_token · Token expired/);
    assert.doesNotMatch(JSON.stringify(body), /hc-secret/);
    const scope = fakeHardcover(403, { error: 'insufficient_scope', scope: 'books:read' });
    const r2 = await (await createHandler({ fetchImpl: scope.fetchImpl, getKeys: async () => keys, now: () => NOW })(post('searchBooks', good), env)).json();
    assert.match(r2.detail, /missing scope: books:read/);
});

test('Hardcover RateLimit is forwarded so the app can pace itself', async () => {
    const good = await token();
    const fetchImpl = async () => new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200, headers: { 'content-type': 'application/json', ratelimit: '"Free";r=7;t=0, "daily";r=4000;t=100' } });
    const res = await createHandler({ fetchImpl, getKeys: async () => keys, now: () => NOW })(post('searchBooks', good), env);
    assert.equal(res.headers.get('x-hc-remaining'), '7');
    assert.match(res.headers.get('access-control-expose-headers'), /x-hc-remaining/);
});

test('stale cache is served when Hardcover rate-limits, fresh within the TTL', async () => {
    const good = await token();
    let t = NOW;
    let mode = 'ok';
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        if (mode === 'ok') return new Response(JSON.stringify({ data: { v: 'first' } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '12' } });
    };
    const cache = memoryCache();
    const handle = createHandler({ fetchImpl, getKeys: async () => keys, now: () => t, cache });
    assert.equal((await handle(post('searchBooks', good), env)).headers.get('x-cache'), 'miss');
    t += 60 * 1000;
    assert.equal((await handle(post('searchBooks', good), env)).headers.get('x-cache'), 'hit', 'within 6 h TTL');
    t += 7 * 3600 * 1000; // past the TTL
    mode = '429';
    const later = Math.floor(t / 1000);
    const fresh = await token({ iat: later - 60, exp: later + 3000, auth_time: later - 60 });
    const res = await handle(post('searchBooks', fresh, undefined), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-cache'), 'stale');
    assert.equal(res.headers.get('retry-after'), '12');
    assert.deepEqual((await res.json()).data, { v: 'first' });
    // nothing cached for these variables: the 429 is passed on
    const miss = await handle(post('searchBooks', fresh, { q: 'other', n: 5 }), env);
    assert.equal(miss.status, 429);
    assert.equal(miss.headers.get('retry-after'), '12');
});
