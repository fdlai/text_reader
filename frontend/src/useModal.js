import { useEffect } from "react";

// Opens a <dialog> as a popup (showModal: the page is dimmed and keyboard
// focus stays inside it) while open is true. When it closes, focus goes
// back to what had it before, usually the button that opened it, so a
// keyboard user carries on from there rather than from the top of the page.
// (The browser does that itself for dialogs closed with .close(), but ours
// are removed from the page instead.)
export function useModal(dialogRef, open = true) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    dialogRef.current.showModal();
    return () => {
      // Not if it's gone, e.g. the row of an article that was just deleted.
      if (opener?.isConnected) opener.focus();
    };
  }, [dialogRef, open]);
}
