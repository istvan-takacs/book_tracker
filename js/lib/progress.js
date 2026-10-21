// Reading progress across formats. Progress is stored as a fraction (0..1)
// so page, percent and audiobook time stay in step for hybrid reads.

export function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
}

export function formatDuration(seconds) {
    const total = Math.max(0, Math.round((seconds || 0) / 60));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return `${m} min`;
    return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Every representation of one position in the book. */
export function describe(fraction, { pages = null, audioSeconds = null } = {}) {
    const f = clamp01(fraction);
    return {
        fraction: f,
        percent: Math.round(f * 100),
        page: pages ? Math.round(f * pages) : null,
        audioSeconds: audioSeconds ? Math.round(f * audioSeconds) : null,
    };
}

/** Convert a value entered in one mode back to a fraction. */
export function toFraction(mode, value, { pages = null, audioSeconds = null } = {}) {
    if (mode === 'page') return pages ? clamp01(value / pages) : 0;
    if (mode === 'time') return audioSeconds ? clamp01(value / audioSeconds) : 0;
    return clamp01(value / 100);
}

/** Step size for the − / + buttons in each mode. */
export function stepFor(mode, { pages = null, audioSeconds = null } = {}) {
    if (mode === 'page' && pages) return 1 / pages;
    if (mode === 'time' && audioSeconds) return 300 / audioSeconds; // 5 minutes
    return 0.01;
}

/** Which modes make sense for this book. */
export function availableModes({ pages = null, audioSeconds = null } = {}) {
    return [pages && 'page', 'percent', audioSeconds && 'time'].filter(Boolean);
}

/** Audiobook time left at this position, in seconds. */
export function remainingSeconds(fraction, audioSeconds) {
    if (!audioSeconds) return null;
    return Math.max(0, Math.round((1 - clamp01(fraction)) * audioSeconds));
}

/**
 * Parse how audiobook apps show time: "5:08" (h:mm), "308" (minutes),
 * "5h 8m", "5 h 08 min", "45m". Returns seconds, or null if unreadable.
 */
export function parseDuration(text) {
    const s = String(text ?? '').trim().toLowerCase();
    if (!s) return null;
    let m = /^(\d{1,3}):([0-5]?\d)$/.exec(s);
    if (m) return (Number(m[1]) * 60 + Number(m[2])) * 60;
    if (/^\d{1,5}$/.test(s)) return Number(s) * 60;
    m = /^(?:(\d{1,3})\s*h(?:ours?|rs?)?)?\s*(?:(\d{1,3})\s*m(?:in(?:ute)?s?)?)?\s*(?:left)?$/.exec(s);
    if (m && (m[1] || m[2])) return ((Number(m[1]) || 0) * 60 + (Number(m[2]) || 0)) * 60;
    return null;
}
