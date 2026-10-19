import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, isValidIsbn10, isValidIsbn13, isbn10to13, isbn13to10, toIsbn13 } from '../js/lib/isbn.js';

test('clean strips Goodreads ="…" wrapping and hyphens', () => {
    assert.equal(clean('="9780765326355"'), '9780765326355');
    assert.equal(clean('0-7653-2635-X'), '076532635X');
});

test('checksums', () => {
    assert.ok(isValidIsbn13('9780765326355'));
    assert.ok(!isValidIsbn13('9780765326356'));
    assert.ok(isValidIsbn10('0765326353'));
    assert.ok(isValidIsbn10('080442957X'));
    assert.ok(!isValidIsbn10('0765326354'));
});

test('ISBN-10 ↔ ISBN-13', () => {
    assert.equal(isbn10to13('0765326353'), '9780765326355');
    assert.equal(isbn13to10('9780765326355'), '0765326353');
    assert.equal(isbn13to10('9791032305690'), null, '979 prefixes have no ISBN-10');
});

test('toIsbn13 accepts scans, typed input and ISBN-10, rejects non-book EANs', () => {
    assert.equal(toIsbn13('9780765326355'), '9780765326355');
    assert.equal(toIsbn13('978-0-7653-2635-5'), '9780765326355');
    assert.equal(toIsbn13('0765326353'), '9780765326355');
    assert.equal(toIsbn13('5012345678900'), null, 'grocery EAN');
    assert.equal(toIsbn13('12345'), null);
    assert.equal(toIsbn13(null), null);
});
