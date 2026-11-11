import { useEffect, useRef, useState } from "react";

// A ⋯ button that opens a short menu of the actions used rarely.
// items: { label, onClick } or { label, href } (opens in a new tab), with
// danger: true for one that deletes something, or { note } for a line of
// text. A line separates the danger items (and notes) from the rest.
// buttonClass: the ⋯ button's size and colors, to suit where it sits.
export default function MoreMenu({
  items,
  buttonClass = "size-11 rounded-full text-gray-600 hover:bg-black/5 hover:text-black",
}) {
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
        className={`flex items-center justify-center ${buttonClass}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
          <path
            fill="currentColor"
            d="M5 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm7 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm7 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z"
          />
        </svg>
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
