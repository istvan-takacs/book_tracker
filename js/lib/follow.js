// Auto-follow on rating: on by default for ratings of 6 and up, off for 5 or
// lower. A choice the reader makes by hand always wins.

export const FOLLOW_THRESHOLD = 6;

export function followDefault(rating) {
    return rating != null && rating >= FOLLOW_THRESHOLD;
}

/** `override` is true/false when the reader ticked or unticked the box, else null. */
export function resolveFollow(rating, override = null) {
    return override ?? followDefault(rating);
}

export function followHint(rating, overridden) {
    if (overridden) return 'You changed these yourself.';
    return followDefault(rating)
        ? `Ticked because you rated it ${FOLLOW_THRESHOLD} or higher.`
        : `Unticked because you rated it ${FOLLOW_THRESHOLD - 1} or lower. Tick to follow anyway.`;
}
