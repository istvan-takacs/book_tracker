// Minimal RS256 JWT helpers on WebCrypto (Workers runtime and Node 20+).

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
    const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

export function importPublicJwk(jwk) {
    return crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, ALG, false, ['verify']);
}

export function importPrivatePem(pem) {
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
    return crypto.subtle.importKey('pkcs8', b64urlDecode(body.replace(/\+/g, '-').replace(/\//g, '_')), ALG, false, ['sign']);
}

export async function signJwt(payload, privateKey, header = {}) {
    const h = b64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header }));
    const p = b64urlEncode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign(ALG, privateKey, enc.encode(`${h}.${p}`));
    return `${h}.${p}.${b64urlEncode(sig)}`;
}

export function decodeJwt(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('malformed_token');
    const json = (s) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    return { header: json(parts[0]), payload: json(parts[1]), signingInput: `${parts[0]}.${parts[1]}`, signature: b64urlDecode(parts[2]) };
}

export async function verifySignature(decoded, publicKey) {
    return crypto.subtle.verify(ALG, publicKey, decoded.signature, enc.encode(decoded.signingInput));
}
