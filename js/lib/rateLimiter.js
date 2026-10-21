// A token bucket mirroring Hardcover's limits (burst of 10, refilling at one
// per second), so the app spends requests on what you're doing right now and
// defers background work instead of tripping the limit.

export const PRIORITY = { interactive: 0, background: 5 };

export function createLimiter({ capacity = 10, refillPerSecond = 1, now = () => Date.now() } = {}) {
    let tokens = capacity;
    let last = now();
    let blockedUntil = 0;

    const refill = () => {
        const t = now();
        tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSecond);
        last = t;
    };

    return {
        /** Tokens available right now (fractional). */
        available() { refill(); return now() < blockedUntil ? 0 : tokens; },

        /**
         * Try to spend one token. Background work needs a reserve left over for
         * interactive use (PRIORITY.background tokens), so it never starves you.
         */
        tryTake(priority = 'interactive') {
            refill();
            if (now() < blockedUntil) return false;
            if (tokens < Math.max(1, PRIORITY[priority] ?? 0)) return false;
            tokens -= 1;
            return true;
        },

        /** Milliseconds until a token for this priority should be available. */
        waitMs(priority = 'interactive') {
            refill();
            const blocked = Math.max(0, blockedUntil - now());
            const need = Math.max(1, (PRIORITY[priority] ?? 0)) - tokens;
            return Math.max(blocked, need > 0 ? Math.ceil((need / refillPerSecond) * 1000) : 0);
        },

        /** Align with what Hardcover reports (`RateLimit: "Free";r=8;t=0`). */
        sync(remaining, resetSeconds = 0) {
            refill();
            if (Number.isFinite(remaining)) tokens = Math.min(tokens, Math.max(0, remaining));
            if (remaining === 0 && resetSeconds > 0) blockedUntil = Math.max(blockedUntil, now() + resetSeconds * 1000);
        },

        /** After a 429: stop until Retry-After has passed. */
        block(seconds) {
            tokens = 0;
            last = now();
            blockedUntil = Math.max(blockedUntil, now() + Math.max(1, seconds) * 1000);
        },

        blockedFor() { return Math.max(0, blockedUntil - now()); },
    };
}

/** Parse the per-minute entry of Hardcover's RateLimit header: `"Free";r=8;t=0, "daily";r=4231;t=51234`. */
export function parseRateLimit(header) {
    if (!header) return null;
    const entries = header.split(',').map((e) => {
        const [name, ...params] = e.trim().split(';');
        const kv = Object.fromEntries(params.map((p) => p.trim().split('=')));
        return { name: name.replace(/"/g, ''), r: Number(kv.r), t: Number(kv.t) };
    });
    const minute = entries.find((e) => e.name !== 'daily') || entries[0];
    const daily = entries.find((e) => e.name === 'daily');
    // once the daily limit is used up only the daily entry is sent
    if (!minute || minute === daily) return daily ? { remaining: daily.r, reset: daily.r === 0 ? daily.t : 0 } : null;
    return { remaining: Math.min(minute.r, daily?.r ?? Infinity), reset: minute.t || 0 };
}
