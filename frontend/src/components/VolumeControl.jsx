// iPhones and iPads only let the device's buttons change the volume:
// setting it on an audio element does nothing, and reading it back gives 1.
// There the slider is hidden, and only the mute button is shown.
const canSetVolume = (() => {
  const audio = new Audio();
  audio.volume = 0.5;
  return audio.volume === 0.5;
})();

// A speaker with no, one or two sound waves, or an X when muted. Like the
// player bar's other icons, it uses the button's text color.
function VolumeIcon({ level }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <path
        d="M2 6h2.5L8 3v10L4.5 10H2a.5.5 0 0 1-.5-.5v-3A.5.5 0 0 1 2 6Z"
        fill="currentColor"
      />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {level === "muted" && <path d="M11 6l4 4M15 6l-4 4" />}
        {level !== "muted" && <path d="M10.5 6a2.5 2.5 0 0 1 0 4" />}
        {level === "high" && <path d="M12.5 4a5 5 0 0 1 0 8" />}
      </g>
    </svg>
  );
}

export default function VolumeControl({
  volume,
  muted,
  onChange,
  onToggleMute,
}) {
  // A volume of 0 counts as muted too, so the icon shows it's silent.
  const silent = muted || volume === 0;
  const level = silent ? "muted" : volume < 0.5 ? "low" : "high";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onToggleMute}
        aria-label={silent ? "Unmute" : "Mute"}
        title={silent ? "Unmute (M)" : "Mute (M)"}
        className="text-gray-600 hover:text-black"
      >
        <VolumeIcon level={level} />
      </button>
      {/* Hidden on narrow screens, where the bar has no room for it; the
          phone's own volume buttons work there anyway. */}
      {canSetVolume && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={silent ? 0 : volume}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Volume"
          title={`Volume ${Math.round((silent ? 0 : volume) * 100)}%`}
          className="hidden w-20 accent-black sm:block"
        />
      )}
    </div>
  );
}
