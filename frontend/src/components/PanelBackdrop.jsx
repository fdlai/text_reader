// An invisible layer over the page while a side panel (Preferences, the
// queue) is open. A click outside the panel lands on it and only closes the
// panel, instead of also clicking whatever is underneath, like an article.
// It sits above the page and header but below the panel and the player bar
// (z-27), so playback can still be controlled. The mouse wheel still scrolls
// the page through it.
export default function PanelBackdrop({ onClose }) {
  return (
    <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-26" />
  );
}
