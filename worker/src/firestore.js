// Read-only Firestore REST access for the calendar feed, authenticated as a
// service account (the feed has no signed-in user; the private token in the
// URL identifies whose releases to serve).

import { importPrivatePem, signJwt } from './jwt.js';

let accessToken = null;
let accessTokenUntil = 0;

async function serviceAccountToken(env, fetchImpl, now) {
    if (accessToken && now < accessTokenUntil - 60000) return accessToken;
    const key = await importPrivatePem(env.FIREBASE_SA_KEY);
    const iat = Math.floor(now / 1000);
    const assertion = await signJwt({
        iss: env.FIREBASE_SA_EMAIL,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600,
    }, key);
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error('service_account_auth_failed');
    const json = await res.json();
    accessToken = json.access_token;
    accessTokenUntil = now + json.expires_in * 1000;
    return accessToken;
}

/** Firestore's typed JSON → plain values. */
export function decodeValue(v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
    if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
    return null;
}

export function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decodeValue(v)]));
}

function base(env) {
    return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

export async function getDoc(env, path, { fetchImpl = fetch, now = Date.now() } = {}) {
    const token = await serviceAccountToken(env, fetchImpl, now);
    const res = await fetchImpl(`${base(env)}/${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore_${res.status}`);
    return decodeFields((await res.json()).fields);
}

/** All documents in a collection (follows pagination). */
export async function listDocs(env, path, { fetchImpl = fetch, now = Date.now(), fields = [] } = {}) {
    const token = await serviceAccountToken(env, fetchImpl, now);
    const out = [];
    let pageToken = '';
    do {
        const qs = new URLSearchParams({ pageSize: '300' });
        for (const f of fields) qs.append('mask.fieldPaths', f);
        if (pageToken) qs.set('pageToken', pageToken);
        const res = await fetchImpl(`${base(env)}/${path}?${qs}`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`firestore_${res.status}`);
        const json = await res.json();
        for (const d of json.documents || []) out.push({ id: d.name.split('/').pop(), ...decodeFields(d.fields) });
        pageToken = json.nextPageToken || '';
    } while (pageToken);
    return out;
}
