// Firebase: Google sign-in (required; no anonymous accounts) and Firestore
// with its persistent offline cache, so the library works without signal.
// Loaded from the gstatic CDN only when config.js has a Firebase config.

const V = '12.10.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

export async function initFirebase(config) {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
    ]);
    const app = initializeApp(config);
    const auth = authMod.initializeAuth(app, {
        persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
        popupRedirectResolver: authMod.browserPopupRedirectResolver,
    });
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

    // Finish a redirect sign-in started on a previous page load.
    authMod.getRedirectResult(auth).catch((e) => console.warn('[firebase] redirect result', e));

    return {
        auth,
        db,
        fs: fsMod,
        onUser: (cb) => authMod.onAuthStateChanged(auth, cb),
        async signIn() {
            try {
                return await authMod.signInWithPopup(auth, provider);
            } catch (e) {
                // Installed iOS web apps can block popups; fall back to a full-page redirect.
                if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
                    return authMod.signInWithRedirect(auth, provider);
                }
                throw e;
            }
        },
        signOut: () => authMod.signOut(auth),
        idToken: () => auth.currentUser?.getIdToken() ?? Promise.resolve(null),
    };
}
