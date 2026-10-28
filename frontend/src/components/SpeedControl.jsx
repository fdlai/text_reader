import { useEffect, useRef, useState } from "react";

const MIN = 0.5;
const MAX = 3;
const STEP = 0.05;
const PRESETS = [0.75, 1, 1.25, 1.5, 2];

// Keeps a speed in range and to 2 decimal places (1.123 -> 1.12).
const clamp = (value) =>
  Math.min(MAX, Math.max(MIN, Math.round(value * 100) / 100));

// "1" or "1.15", without trailing zeros.
const format = (rate) => String(Number(rate.toFixed(2)));

// + and - move to the next multiple of 0.05, so a typed 1.12 becomes 1.15
// or 1.10 rather than 1.17 or 1.07. The tiny 1e-9 guards against floating
// point values like 1.15 being stored as 1.1499999.
const stepUp = (rate) => clamp(Math.floor(rate / STEP + 1e-9) * STEP + STEP);
const stepDown = (rate) => clamp(Math.ceil(rate / STEP - 1e-9) * STEP - STEP);

export default function SpeedControl({ rate, onChange }) {
  const [open, setOpen] = useState(false);
  // While the number box is being typed in, it shows the typed text rather
  // than the current speed. null when not editing.
  const [draft, setDraft] = useState(null);
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

  function commitDraft() {
    const value = Number(draft);
    if (draft !== null && draft.trim() !== "" && !Number.isNaN(value)) {
      onChange(clamp(value));
    }
    setDraft(null);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Playback speed"
        className="w-16 rounded border border-gray-300 py-1 text-sm tabular-nums"
      >
        {format(rate)}x
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-64 space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <button
              onClick={() => onChange(stepDown(rate))}
              disabled={rate <= MIN}
              aria-label="Slower"
              className="h-9 w-9 rounded-full border border-gray-300 text-lg disabled:opacity-40"
            >
              −
            </button>
            <label className="flex items-baseline gap-0.5 text-2xl font-semibold tabular-nums">
              <input
                value={draft ?? format(rate)}
                onFocus={(e) => {
                  setDraft(format(rate));
                  e.target.select();
                }}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitDraft}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                inputMode="decimal"
                aria-label="Exact speed"
                className="w-16 rounded text-center hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
              />
              x
            </label>
            <button
              onClick={() => onChange(stepUp(rate))}
              disabled={rate >= MAX}
              aria-label="Faster"
              className="h-9 w-9 rounded-full border border-gray-300 text-lg disabled:opacity-40"
            >
              +
            </button>
          </div>

          <input
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={rate}
            onChange={(e) => onChange(clamp(Number(e.target.value)))}
            aria-label="Speed slider"
            className="w-full cursor-pointer accent-black"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>{MIN}x</span>
            <span>{MAX}x</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => onChange(p)}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  rate === p
                    ? "border-black bg-black text-white"
                    : "border-gray-300 hover:border-black"
                }`}
              >
                {format(p)}x
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
