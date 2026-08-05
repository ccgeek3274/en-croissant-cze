// Who owns a file dropped on the window.
//
// The app-wide handler in `routes/__root.tsx` opens every dropped .pgn as its own
// database, which is the right default — but wrong while a dialog is asking for
// files ("Import moves" wants the games *inside* the drop, merged into the open
// database, not four new tabs). Tauri's drag-drop event is window-global and every
// listener gets it, so the dialog cannot simply "consume" the event; it has to say
// in advance that the drop is spoken for.
//
// A counter rather than a boolean: two dialogs can overlap during a close
// animation, and the second one unmounting must not un-claim for the first.

let claims = 0;

/** Claim dropped files for as long as the returned function has not been called.
 *  Pair it with a dialog's lifetime (`useEffect` on `opened`). */
export function claimFileDrop(): () => void {
    claims++;
    let released = false;
    return () => {
        if (released) return; // a double release would free someone else's claim
        released = true;
        claims--;
    };
}

/** True while some dialog is handling dropped files itself. */
export function isFileDropClaimed(): boolean {
    return claims > 0;
}
