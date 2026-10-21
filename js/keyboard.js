// Keep bottom-anchored controls (search bar, sheets, toasts) above the
// on-screen keyboard. iOS doesn't shrink the layout viewport when the
// keyboard opens, so fixed-bottom elements end up behind it; the visual
// viewport does shrink, which tells us how much space the keyboard takes.

/** Pixels hidden by the keyboard (pure, for tests). */
export function keyboardInset({ innerHeight, vvHeight, vvOffsetTop = 0 }) {
    if (!innerHeight || !vvHeight) return 0;
    return Math.max(0, Math.round(innerHeight - vvHeight - vvOffsetTop));
}

export const KEYBOARD_OPEN_PX = 80;

export function startKeyboardTracking() {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    const root = document.documentElement;
    const update = () => {
        const inset = keyboardInset({ innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop });
        const open = inset > KEYBOARD_OPEN_PX;
        root.style.setProperty('--kb', `${open ? inset : 0}px`);
        document.body.classList.toggle('kb-open', open);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('focusout', () => setTimeout(update, 120));
    update();
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
}
