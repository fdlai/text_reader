import { useEffect } from "react";
import { Link, useMatch } from "react-router-dom";
import { useGeneration } from "../context/generation";
import { SKIP_SECONDS, usePlayer } from "../context/PlayerContext";
import { usePreferences } from "../context/preferences";
import { formatTime } from "../timeline";
import SpeedControl from "./SpeedControl";
import VolumeControl from "./VolumeControl";

// The icons fill with the button's text color, so they follow the theme.
function PlayIcon() {
  // Drawn 1px right of center: a centered triangle looks shifted left,
  // because most of its shape is on the flat side.
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <path
        d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

export default function PlayerBar() {
  const {
    session,
    index,
    playing,
    finished,
    waiting,
    rate,
    changeRate,
    volume,
    muted,
    changeVolume,
    toggleMute,
    timeline,
    position,
    seekTo,
    toggle,
    skip,
  } = usePlayer();
  const { togglePanel } = usePreferences();
  const { paused } = useGeneration();
  const reading = useMatch("/documents/:id");

  // M mutes/unmutes on any page while the bar is shown. Ignored like the
  // other shortcuts: while typing in a box, with Ctrl/Alt held, or while a
  // popup is open.
  useEffect(() => {
    if (!session) return;
    function handleKey(e) {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target.closest("input, select, textarea, [contenteditable], dialog")
      )
        return;
      toggleMute();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [session, toggleMute]);

  if (!session) return null;

  // Times are shown in real time, so at 2x a 10-minute document shows 5:00.
  const elapsed = position / rate;
  const remaining = (timeline.total - position) / rate;

  return (
    <div
      data-player-bar
      className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white"
    >
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
          className="flex-1 accent-black"
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
            {finished
              ? "Finished"
              : waiting
                ? paused
                  ? "Generation paused (resume it to keep listening)"
                  : "Generating next section..."
                : `Section ${index + 1} of ${session.chunks.length}`}
          </p>
        </Link>
        <button
          onClick={() => skip(-SKIP_SECONDS)}
          className="text-sm text-gray-600 hover:text-black"
        >
          -{SKIP_SECONDS}s
        </button>
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black text-white hover:opacity-85"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          onClick={() => skip(SKIP_SECONDS)}
          className="text-sm text-gray-600 hover:text-black"
        >
          +{SKIP_SECONDS}s
        </button>
        <SpeedControl rate={rate} onChange={changeRate} />
        <VolumeControl
          volume={volume}
          muted={muted}
          onChange={changeVolume}
          onToggleMute={toggleMute}
        />
        {/* The Preferences panel belongs to the article page. */}
        {reading && (
          <button
            onClick={togglePanel}
            title="Preferences (P)"
            aria-label="Preferences"
            className="text-lg text-gray-600 hover:text-black"
          >
            ⚙
          </button>
        )}
      </div>
    </div>
  );
}
