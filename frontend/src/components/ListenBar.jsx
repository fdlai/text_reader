import { useEffect, useRef, useState } from "react";

// The Reader's listening controls, as one rounded bar: a round button (play,
// pause, generate...) with its label and the voice under it, then a status
// (time left, or how generation is going), the next part, and a ⋯ menu with
// the actions used rarely.
//
// The bar's background fills from the left as you listen: a light layer for
// the audio made so far, and a darker one for what's been listened to.
//
// action: { icon, label, onClick, disabled }, where icon is a key of PATHS.
// menu: items for the ⋯ menu (see MoreMenu).
// made, heard: percentages (0 to 100).
export default function ListenBar({
  action,
  voice,
  status,
  next,
  menu,
  made,
  heard,
}) {
  return (
    // Wraps onto two lines on narrow screens; the large rounding still
    // makes it a pill when it's one line. No wider than the "Normal" page
    // width, so on wider pages it doesn't stretch across the screen.
    <div className="relative mt-6 flex min-h-16 max-w-3xl flex-wrap items-center gap-x-1 gap-y-2 rounded-[2rem] p-2">
      {/* The fill has its own clipped layer, so the voice and ⋯ menus can
          still open outside the bar. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden rounded-[2rem] bg-gray-100"
      >
        <div
          className="absolute inset-y-0 left-0 bg-gray-200"
          style={{ width: `${made}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-gray-300"
          style={{ width: `${heard}%` }}
        />
      </div>

      <div className="relative flex min-w-0 items-center gap-3">
        <button
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.label}
          title={action.label}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-black text-white hover:opacity-85 disabled:opacity-40"
        >
          <Icon name={action.icon} />
        </button>
        <div className="min-w-0 pr-2">
          <p className="leading-snug font-semibold">{action.label}</p>
          {voice}
        </div>
      </div>

      <div className="relative ml-auto flex items-center gap-1">
        {status && (
          <div className="px-2.5 text-sm text-gray-600 tabular-nums">
            {status}
          </div>
        )}
        {next && (
          <>
            <span className="mx-0.5 h-6 w-px bg-gray-400/50" />
            {next}
          </>
        )}
        <MoreMenu items={menu} />
      </div>
    </div>
  );
}

// items: { label, onClick } or { label, href } (opens in a new tab), with
// danger: true for one that deletes something, or { note } for a line of
// text. A line separates the danger items (and notes) from the rest.
function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close when clicking anywhere outside, or pressing Escape.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center rounded px-3 py-2 text-left text-gray-700 hover:bg-gray-100 hover:text-black";
  const firstApart = items.findIndex((item) => item.danger || item.note);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-expanded={open}
        title="More actions"
        className="flex size-11 items-center justify-center rounded-full text-gray-600 hover:bg-black/5 hover:text-black"
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-1.5 text-sm shadow-xl">
          {items.map((item, i) => (
            <div key={item.label ?? item.note}>
              {i === firstApart && i > 0 && (
                <hr className="mx-1 my-1.5 border-gray-200" />
              )}
              {item.note ? (
                <p className="px-3 py-1.5 text-xs text-gray-500">{item.note}</p>
              ) : item.href ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className={itemClass}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`${itemClass} ${item.danger ? "hover:text-red-600" : ""}`}
                >
                  {item.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Drawn on a 24×24 grid. Filled shapes for play and pause, lines for the
// rest.
const PATHS = {
  play: (
    <path
      fill="currentColor"
      stroke="none"
      d="M8 5.3v13.4a.8.8 0 0 0 1.2.7l10.5-6.7a.8.8 0 0 0 0-1.4L9.2 4.6A.8.8 0 0 0 8 5.3z"
    />
  ),
  pause: (
    <path
      fill="currentColor"
      stroke="none"
      d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"
    />
  ),
  again: <path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.5 4.5V9H9" />,
  // Sound waves, for generating audio.
  generate: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  // An hourglass, while the audio is being prepared.
  wait: (
    <path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8s8 3 8 8" />
  ),
  more: (
    <path
      fill="currentColor"
      stroke="none"
      d="M5 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm7 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm7 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z"
    />
  ),
};

function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
