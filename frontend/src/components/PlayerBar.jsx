import { Link } from "react-router-dom";
import { usePlayer } from "../context/PlayerContext";
import { formatTime } from "../timeline";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export default function PlayerBar() {
  const {
    session,
    index,
    playing,
    waiting,
    rate,
    setRate,
    timeline,
    position,
    seekTo,
    toggle,
    skip,
  } = usePlayer();
  if (!session) return null;

  // Times are shown in real time, so at 2x a 10-minute document shows 5:00.
  const elapsed = position / rate;
  const remaining = (timeline.total - position) / rate;

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white">
      <div className="flex items-center gap-3 px-8 pt-3 text-xs text-gray-500 tabular-nums">
        <span className="w-14">{formatTime(elapsed)}</span>
        <input
          type="range"
          min={0}
          max={timeline.total}
          step={1}
          value={position}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Playback position"
          className="flex-1 cursor-pointer accent-black"
        />
        {/* "~" marks an estimate while some chunks have no audio yet. */}
        <span className="w-14 text-right">
          {timeline.exact ? "" : "~"}-{formatTime(remaining)}
        </span>
      </div>
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-8 py-3">
        <Link
          to={`/documents/${session.documentId}`}
          className="min-w-0 flex-1"
        >
          <p className="truncate text-sm font-medium">{session.title}</p>
          <p className="text-xs text-gray-500">
            {waiting
              ? "Generating next section..."
              : `Section ${index + 1} of ${session.chunks.length}`}
          </p>
        </Link>
        <button
          onClick={() => skip(-15)}
          className="text-sm text-gray-600 hover:text-black"
        >
          -15s
        </button>
        <button
          onClick={toggle}
          className="w-16 rounded-full bg-black py-2 text-sm text-white"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => skip(15)}
          className="text-sm text-gray-600 hover:text-black"
        >
          +15s
        </button>
        <select
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="rounded border border-gray-300 px-1 py-1 text-sm"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
