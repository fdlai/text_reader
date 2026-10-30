// The Audifire logo: sound-meter bars whose heights make the shape of a
// flame, yellow at the base to red at the tip. The colors are the same in
// every theme. public/favicon.svg is the same drawing, for the browser tab.
export default function Logo({ className }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        {/* A fixed id is fine, since the logo appears once per page. */}
        <linearGradient
          id="audifire-fire"
          gradientUnits="userSpaceOnUse"
          x1="10"
          y1="30"
          x2="22"
          y2="2"
        >
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="0.45" stopColor="#f97316" />
          <stop offset="1" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <g fill="url(#audifire-fire)">
        <rect x="4.4" y="19" width="3.2" height="10" rx="1.6" />
        <rect x="9.4" y="11" width="3.2" height="18" rx="1.6" />
        <rect x="14.4" y="3" width="3.2" height="26" rx="1.6" />
        <rect x="19.4" y="13" width="3.2" height="16" rx="1.6" />
        <rect x="24.4" y="21" width="3.2" height="8" rx="1.6" />
      </g>
    </svg>
  );
}
