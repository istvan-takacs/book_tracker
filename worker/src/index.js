// Book Tracker Worker: keeps the Hardcover token secret and serves the
// private calendar feed.
//
//   POST /q/:operation   allowlisted Hardcover query; requires a Firebase ID token
//   GET  /cal/:token.ics subscribed calendar feed (the token is the secret)
//   GET  /health         token-free status check, used by Settings
//
// Secrets (wrangler secret put …): HARDCOVER_TOKEN, ALLOWED_UIDS,
// FIREBASE_SA_EMAIL, FIREBASE_SA_KEY. Vars (wrangler.toml): FIREBASE_PROJECT_ID, ALLOWED_ORIGINS.

import { OPERATIONS, validateVariables } from './queries.js';
import { verifyIdToken, googleKeys } from './firebaseAuth.js';
import { getDoc, listDocs } from './firestore.js';
import { buildIcs, calendarBooks, releaseEvent } from '../../js/lib/calendar.js';
import { todayIso } from '../../js/lib/dates.js';
import { parseRateLimit } from '../../js/lib/rateLimiter.js';

const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';
const USER_AGENT = 'book-tracker personal app (Cloudflare Worker)';

const STALE_SECONDS = 7 * 24 * 3600;

/** Hardcover's RateLimit / Retry-After headers, as x-hc-remaining / x-hc-reset / retry-after. */
export function rateHeaders(res) {
    const out = {};
    const parsed = parseRateLimit(res.headers.get('ratelimit'));
    const legacy = res.headers.get('x-ratelimit-remaining');
    const remaining = parsed?.remaining ?? (legacy != null ? Number(legacy) : null);
    if (Number.isFinite(remaining)) out['x-hc-remaining'] = String(remaining);
    if (parsed?.reset) out['x-hc-reset'] = String(parsed.reset);
    const retry = res.headers.get('retry-after');
    if (retry) out['retry-after'] = retry;
    return out;
}

function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, env) {
    if (!origin || !allowedOrigins(env).includes(origin)) return {};
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, GET, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '86400',
        'access-control-expose-headers': 'x-hc-remaining, x-hc-reset, retry-after, x-cache',
        vary: 'Origin',
    };
}

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tolerate common paste mistakes: surrounding quotes, whitespace, a "Bearer " prefix. */
export function hardcoverAuthHeader(token) {
    const t = String(token || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/^bearer\s+/i, '').trim();
    return `Bearer ${t}`;
}

/** Map Hardcover failures to responses the app can explain to the reader. */
function hardcoverFailure(status, body) {
    // Hardcover's own reason (never the token) helps tell an expired token from a missing scope.
    const detail = [body?.error, body?.error_description, body?.scope && `missing scope: ${body.scope}`, body?.message].filter((x) => typeof x === 'string' && x).join(' · ').slice(0, 300) || null;
    if (status === 401) return json({ error: 'hardcover_token', message: 'Hardcover rejected the access token (missing, invalid or expired).', detail, hardcoverStatus: status }, 503);
    if (status === 429) return json({ error: 'rate_limited', message: 'Book data limit reached for the moment.', detail, hardcoverStatus: status }, 429);
    if (status === 403) return json({ error: 'hardcover_forbidden', message: 'Hardcover refused the query (often a missing token scope).', detail, hardcoverStatus: status }, 502);
    return json({ error: 'hardcover_unavailable', message: `Hardcover responded with ${status}.`, detail, hardcoverStatus: status }, 502);
}

export function createHandler({ fetchImpl = (...a) => fetch(...a), cache = null, now = () => Date.now(), getKeys = null } = {}) {
    async function handleQuery(request, env, opName, cors) {
        const origin = request.headers.get('origin');
        if (origin && !allowedOrigins(env).includes(origin)) return json({ error: 'origin_not_allowed' }, 403);

        const auth = request.headers.get('authorization') || '';
        const idToken = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
        if (!idToken) return json({ error: 'sign_in_required' }, 401, cors);
        let uid;
        try {
            uid = await verifyIdToken(idToken, {
                projectId: env.FIREBASE_PROJECT_ID,
                getKeys: getKeys || (() => googleKeys(fetchImpl, now())),
                now: now(),
            });
        } catch (e) {
            return json({ error: 'invalid_sign_in', reason: e.message }, 401, cors);
        }
        const allowed = (env.ALLOWED_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!allowed.includes(uid)) return json({ error: 'not_allowed' }, 403, cors);

        const op = OPERATIONS[opName];
        if (!op) return json({ error: 'unknown_operation' }, 404, cors);
        let variables;
        try { variables = (await request.json())?.variables ?? {}; } catch { return json({ error: 'invalid_json' }, 400, cors); }
        const problem = validateVariables(opName, variables);
        if (problem) return json({ error: problem }, 400, cors);

        // Cached answers are kept for a week: fresh within the operation's TTL,
        // and used as a fallback when Hardcover is rate-limiting or down.
        const cacheKey = new Request(`https://cache.book-tracker/${opName}/${await sha256Hex(JSON.stringify(variables))}`);
        let stale = null;
        if (cache) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                const fetchedAt = Number(hit.headers.get('x-fetched-at')) || 0;
                const text = await hit.text();
                if (now() - fetchedAt < op.ttl * 1000) {
                    return new Response(text, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': 'hit', ...cors } });
                }
                stale = text;
            }
        }
        const serveStale = (extra = {}) => new Response(stale, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': 'stale', ...extra, ...cors } });

        if (!env.HARDCOVER_TOKEN) return json({ error: 'hardcover_token', message: 'The Worker has no Hardcover token configured.' }, 503, cors);
        let res;
        try {
            res = await fetchImpl(HARDCOVER_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: hardcoverAuthHeader(env.HARDCOVER_TOKEN), 'user-agent': USER_AGENT },
                body: JSON.stringify({ query: op.query, variables, operationName: opName }),
            });
        } catch {
            if (stale) return serveStale();
            return json({ error: 'hardcover_unavailable', message: 'Could not reach Hardcover.' }, 502, cors);
        }
        // Tell the app how many requests are left so it can pace itself.
        const rate = rateHeaders(res);
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            if (stale && (res.status === 429 || res.status >= 500)) return serveStale(rate);
            const r = hardcoverFailure(res.status, body);
            for (const [k, v] of Object.entries({ ...rate, ...cors })) r.headers.set(k, v);
            return r;
        }
        if (body?.errors?.length) {
            if (stale) return serveStale(rate);
            return json({ error: 'hardcover_query_error', message: body.errors[0]?.message || 'Query failed.' }, 502, { ...rate, ...cors });
        }

        const payload = JSON.stringify({ data: body.data });
        if (cache) {
            await cache.put(cacheKey, new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${STALE_SECONDS}`, 'x-fetched-at': String(now()) } }));
        }
        return new Response(payload, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': 'miss', ...rate, ...cors } });
    }

    async function handleCalendar(request, env, token) {
        if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return new Response('Not found', { status: 404 });
        const cacheKey = new Request(`https://cache.book-tracker/cal/${await sha256Hex(token)}`);
        if (cache) {
            const hit = await cache.match(cacheKey);
            if (hit) return hit;
        }
        const ref = await getDoc(env, `calendarTokens/${token}`, { fetchImpl, now: now() });
        if (!ref?.uid) return new Response('Not found', { status: 404 });
        const books = await listDocs(env, `users/${ref.uid}/books`, {
            fetchImpl, now: now(),
            fields: ['title', 'authors', 'series', 'status', 'releaseDate', 'datePrecision', 'releaseDateOverride', 'key'],
        });
        const withKeys = books.map((b) => ({ ...b, key: b.key || b.id }));
        const events = calendarBooks(withKeys, todayIso(new Date(now()))).map(({ book, date }) => releaseEvent(book, date, { appUrl: env.APP_URL || '' }));
        const ics = buildIcs(events, { name: 'Book releases', now: new Date(now()) });
        const response = new Response(ics, {
            headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'max-age=3600', 'content-disposition': 'inline; filename="book-releases.ics"' },
        });
        if (cache) await cache.put(cacheKey, response.clone());
        return response;
    }

    return async function handle(request, env) {
        const url = new URL(request.url);
        const cors = corsHeaders(request.headers.get('origin'), env);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        try {
            const q = /^\/q\/([A-Za-z]+)$/.exec(url.pathname);
            if (q && request.method === 'POST') return await handleQuery(request, env, q[1], cors);
            const cal = /^\/cal\/([^/]+)\.ics$/.exec(url.pathname);
            if (cal && request.method === 'GET') return await handleCalendar(request, env, cal[1]);
            if (url.pathname === '/health') return json({ ok: true, hardcoverConfigured: !!env.HARDCOVER_TOKEN }, 200, cors);
            return json({ error: 'not_found' }, 404, cors);
        } catch (e) {
            return json({ error: 'worker_error', message: e.message }, 500, cors);
        }
    };
}

export default {
    fetch(request, env, ctx) {
        return createHandler({ cache: caches.default })(request, env, ctx);
    },
};
