// A Library entry's progress: "24 min" before listening, "30% · 15 min
// left" partway through, "Finished" at the end, each with a small icon.
export default function ListeningStatus({ finished, fraction, secondsLeft }) {
  let icon, text;
  if (finished) {
    icon = <FinishedIcon />;
    text = "Finished";
  } else if (fraction > 0) {
    // Rounded down, and kept between 1% and 99%, so it never says 0% after
    // starting or 100% before the end.
    const percent = Math.min(99, Math.max(1, Math.floor(fraction * 100)));
    icon = <ProgressCircle fraction={fraction} />;
    text = `${percent}% · ${formatMinutes(secondsLeft)} left`;
  } else {
    icon = <ProgressCircle fraction={0} />;
    text = formatMinutes(secondsLeft);
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
      {icon}
      {text}
    </p>
  );
}

// "1 hr 5 min" or "15 min". At least 1 min, since times are estimates.
function formatMinutes(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// A ring that fills clockwise from the top. The filled part is a dashed
// stroke: one dash as long as the fraction of the circumference, then a gap.
function ProgressCircle({ fraction }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90">
      <circle
        cx="8"
        cy="8"
        r={RADIUS}
        fill="none"
        strokeWidth="2"
        className="stroke-gray-300"
      />
      <circle
        cx="8"
        cy="8"
        r={RADIUS}
        fill="none"
        strokeWidth="2"
        strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        className="stroke-gray-500"
      />
    </svg>
  );
}

function FinishedIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4">
      <circle cx="8" cy="8" r="7" className="fill-gray-500" />
      <path
        d="M5 8.2 7 10.2 11 6"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-white"
      />
    </svg>
  );
}
