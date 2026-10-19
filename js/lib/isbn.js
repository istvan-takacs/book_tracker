// ISBN parsing for barcode scans, typed input and Goodreads exports.

/** Keep digits and a trailing X; Goodreads exports wrap ISBNs as ="978…". */
export function clean(raw) {
    return String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(s) {
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0;
}

export function isValidIsbn13(s) {
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
}

function check13(first12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
    return String((10 - (sum % 10)) % 10);
}

export function isbn10to13(s) {
    if (!isValidIsbn10(s)) return null;
    const core = '978' + s.slice(0, 9);
    return core + check13(core);
}

/** Only 978-prefixed ISBN-13s have an ISBN-10 form. */
export function isbn13to10(s) {
    if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
    const core = s.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
    const c = (11 - (sum % 11)) % 11;
    return core + (c === 10 ? 'X' : String(c));
}

/**
 * Any user- or scanner-supplied value → canonical ISBN-13, or null.
 * EAN-13 barcodes on books start with 978/979 (Bookland); other EANs are rejected.
 */
export function toIsbn13(raw) {
    const s = clean(raw);
    if (s.length === 13) return isValidIsbn13(s) && /^97[89]/.test(s) ? s : null;
    if (s.length === 10) return isbn10to13(s);
    return null;
}
