// Verify Firebase ID tokens without the Admin SDK, following
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

import { decodeJwt, importPublicJwk, verifySignature } from './jwt.js';

export const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedKeys = null;
let cachedUntil = 0;

/** Google's signing keys, cached for as long as Cache-Control allows (max 6 h). */
export async function googleKeys(fetchImpl = fetch, now = Date.now()) {
    if (cachedKeys && now < cachedUntil) return cachedKeys;
    const res = await fetchImpl(JWKS_URL);
    if (!res.ok) throw new Error('jwks_unavailable');
    const { keys } = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
    cachedKeys = Object.fromEntries(keys.map((k) => [k.kid, k]));
    cachedUntil = now + Math.min(maxAge, 6 * 3600) * 1000;
    return cachedKeys;
}

export function resetKeyCache() {
    cachedKeys = null;
    cachedUntil = 0;
}

/**
 * Returns the token's uid, or throws with a short reason.
 * `getKeys` returns { kid: jwk }; injectable for tests.
 */
export async function verifyIdToken(token, { projectId, getKeys = () => googleKeys(), now = Date.now(), skewSeconds = 60 }) {
    if (!projectId) throw new Error('server_misconfigured');
    let decoded;
    try { decoded = decodeJwt(token); } catch { throw new Error('malformed_token'); }
    const { header, payload } = decoded;
    if (header.alg !== 'RS256' || !header.kid) throw new Error('bad_header');
    const t = Math.floor(now / 1000);
    if (typeof payload.exp !== 'number' || payload.exp + skewSeconds < t) throw new Error('expired');
    if (typeof payload.iat !== 'number' || payload.iat - skewSeconds > t) throw new Error('issued_in_future');
    if (typeof payload.auth_time === 'number' && payload.auth_time - skewSeconds > t) throw new Error('auth_in_future');
    if (payload.aud !== projectId) throw new Error('wrong_audience');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong_issuer');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('bad_subject');
    const jwk = (await getKeys())[header.kid];
    if (!jwk) throw new Error('unknown_key');
    const ok = await verifySignature(decoded, await importPublicJwk(jwk));
    if (!ok) throw new Error('bad_signature');
    return payload.sub;
}
