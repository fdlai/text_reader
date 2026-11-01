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

// A chevron pointing down (hide the bar) or up (show it).
function ChevronIcon({ up }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={up ? "m3.5 10 4.5-4.5 4.5 4.5" : "m3.5 6 4.5 4.5 4.5-4.5"} />
    </svg>
  );
}

// The thin progress line shown while the bar is hidden. Clicking it (or
// dragging along it) jumps there, like the bar's progress slider. Its
// clickable area is taller than the line, so it's easy to hit.
function ProgressLine({ position, total, seekTo }) {
  function seekToPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(
      Math.max((e.clientX - rect.left) / rect.width, 0),
      1,
    );
    seekTo(fraction * total);
  }
  return (
    <div
      data-player-bar
      role="slider"
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(position)}
      title="Jump to a point"
      onPointerDown={(e) => {
        // Keeps receiving the moves while dragging, even off the line.
        e.currentTarget.setPointerCapture(e.pointerId);
        seekToPointer(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekToPointer(e);
      }}
      className="group fixed inset-x-0 bottom-0 flex h-3 cursor-pointer items-end"
    >
      <div className="h-[3px] w-full bg-gray-200 transition-[height] group-hover:h-1.5">
        <div
          className="h-full bg-black"
          style={{ width: `${total ? (position / total) * 100 : 0}%` }}
        />
      </div>
    </div>
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
    barHidden,
    toggleBar,
  } = usePlayer();
  const { togglePanel } = usePreferences();
  const { paused } = useGeneration();
  const reading = useMatch("/documents/:id");

  // M mutes/unmutes and H hides/shows the bar, on any page while something
  // is playing. Ignored like the other shortcuts: while typing in a box,
  // with Ctrl/Alt held, or while a popup is open.
  useEffect(() => {
    if (!session) return;
    function handleKey(e) {
      const key = e.key.toLowerCase();
      if (key !== "m" && key !== "h") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target.closest("input, select, textarea, [contenteditable], dialog")
      )
        return;
      if (key === "m") toggleMute();
      else toggleBar();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [session, toggleMute, toggleBar]);

  if (!session) return null;

  // Times are shown in real time, so at 2x a 10-minute document shows 5:00.
  const elapsed = position / rate;
  const remaining = (timeline.total - position) / rate;

  return (
    <>
      {/* Hidden, it slides down out of view, leaving a small play/pause
        button with a way back, and a thin progress line along the bottom. */}
      {barHidden && (
        <>
          <div
            data-player-bar
            className="fixed right-4 bottom-4 flex items-center gap-1 rounded-full border border-gray-200 bg-white p-1 shadow-lg"
          >
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className="flex size-9 items-center justify-center rounded-full bg-black text-white hover:opacity-85"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              onClick={toggleBar}
              aria-label="Show player bar"
              title="Show player bar (H)"
              className="flex size-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-black"
            >
              <ChevronIcon up />
            </button>
          </div>
          <ProgressLine
            position={position}
            total={timeline.total}
            seekTo={seekTo}
          />
        </>
      )}
      <div
        data-player-bar
        inert={barHidden}
        className={`fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white transition-transform duration-300 motion-reduce:transition-none ${
          barHidden ? "translate-y-full" : ""
        }`}
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
        <button
          onClick={toggleBar}
          aria-label="Hide player bar"
          title="Hide player bar (H)"
          className="absolute right-4 bottom-4 flex size-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black"
        >
          <ChevronIcon />
        </button>
      </div>
    </>
  );
}
