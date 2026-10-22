// Firebase: Google sign-in (required; no anonymous accounts) and Firestore
// with its persistent offline cache, so the library works without signal.
// Loaded from the gstatic CDN only when config.js has a Firebase config.

// Keep in step with the modulepreload links in index.html.
const V = '12.10.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

const REDIRECT_FLAG = 'bt-auth-redirect';
function redirectPending() {
    try { return localStorage.getItem(REDIRECT_FLAG) === '1'; } catch { return false; }
}
function setRedirectPending(on) {
    try { if (on) localStorage.setItem(REDIRECT_FLAG, '1'); else localStorage.removeItem(REDIRECT_FLAG); } catch { /* blocked storage */ }
}

export async function initFirebase(config) {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
    ]);
    const app = initializeApp(config);
    // No popupRedirectResolver here: on iOS and mobile, Auth would then load
    // an iframe from authDomain and check for a redirect before reporting the
    // signed-in user, on every launch. It's passed to the sign-in calls instead.
    const auth = authMod.initializeAuth(app, {
        persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
    });
    const resolver = authMod.browserPopupRedirectResolver;
    let db;
    try {
        db = fsMod.initializeFirestore(app, {
            localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
        });
    } catch (e) {
        console.warn('[firebase] offline cache unavailable, using memory cache', e);
        db = fsMod.initializeFirestore(app, {});
    }
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Finish a redirect sign-in started on a previous page load (only then, as
    // checking costs the same iframe load).
    if (redirectPending()) {
        authMod.getRedirectResult(auth, resolver)
            .catch((e) => console.warn('[firebase] redirect result', e))
            .finally(() => setRedirectPending(false));
    }

    return {
        auth,
        db,
        fs: fsMod,
        onUser: (cb) => authMod.onAuthStateChanged(auth, cb),
        async signIn() {
            try {
                return await authMod.signInWithPopup(auth, provider, resolver);
            } catch (e) {
                // Installed iOS web apps can block popups; fall back to a full-page redirect.
                if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
                    setRedirectPending(true);
                    return authMod.signInWithRedirect(auth, provider, resolver);
                }
                throw e;
            }
        },
        signOut: () => authMod.signOut(auth),
        idToken: () => auth.currentUser?.getIdToken() ?? Promise.resolve(null),
    };
}
