import { useEffect, useState } from "react";
import { Link, useMatch } from "react-router-dom";
import { useBreadcrumb } from "../context/breadcrumb";
import { useGeneration } from "../context/generation";
import { usePreferences } from "../context/preferences";
import Logo from "./Logo";

// True while the page is being scrolled down, false again as soon as it's
// scrolled up. Near the top of the page it's always false.
function useScrollingDown() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    function handleScroll() {
      const y = window.scrollY;
      // Tiny movements (e.g. a trackpad settling) don't count. lastY isn't
      // updated, so a slow scroll still adds up and counts.
      if (Math.abs(y - lastY) < 5) return;
      setDown(y > lastY && y > 64);
      lastY = y;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  return down;
}

// Two arrows chasing each other, turning slowly while audio is generated.
function GeneratingIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 animate-[spin_3s_linear_infinite]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </svg>
  );
}

// Three lines with dots, like a list.
function ListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function PausedIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

// The bar at the top of every page. It slides out of view while scrolling
// down, so the text gets the whole screen, and comes back on scrolling up.
export default function Header() {
  const { togglePanel } = usePreferences();
  const { breadcrumb } = useBreadcrumb();
  const generation = useGeneration();
  const queued = generation.queued;
  const articles = `${queued} ${queued === 1 ? "article" : "articles"}`;
  const queueTitle =
    queued === 0
      ? "Generation queue: nothing waiting"
      : generation.paused
        ? `Generation paused, ${articles} waiting`
        : `Generating ${articles}`;
  const reading = useMatch("/documents/:id");
  const home = useMatch("/");
  const collection = useMatch("/collections/:id");
  const voices = useMatch("/voices");
  const hidden = useScrollingDown();

  // P opens/closes Preferences on any page. Ignored while typing in a box,
  // with Ctrl/Alt held (e.g. Ctrl+P prints), or while a popup is open.
  useEffect(() => {
    function handleKey(e) {
      if (e.key !== "p" && e.key !== "P") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target.closest("input, select, textarea, [contenteditable], dialog")
      )
        return;
      togglePanel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePanel]);
  const library = home || collection;

  // Collections and articles count as being in the Library, so Library
  // stays highlighted.
  const navClass = (active) =>
    active ? "font-medium text-black" : "text-gray-600 hover:text-black";

  return (
    // focus-within: moving to a link with Tab brings the header back.
    <header
      className={`sticky top-0 z-25 border-b border-gray-200 bg-white transition-transform duration-200 focus-within:translate-y-0 ${hidden ? "-translate-y-full" : ""}`}
    >
      <div className="flex items-center gap-8 px-8 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
          <Logo className="size-6" />
          Audifire
        </Link>
        <nav className="flex gap-5 text-sm">
          <Link
            to="/"
            aria-current={library ? "page" : undefined}
            className={navClass(library || reading)}
          >
            Library
          </Link>
          <Link
            to="/voices"
            aria-current={voices ? "page" : undefined}
            className={navClass(voices)}
          >
            Voices
          </Link>
        </nav>
        {/* Where the open article is, linking back there. Cut short with
            "…" rather than wrapping; hovering shows the whole name. */}
        {reading && breadcrumb && (
          <Link
            to={breadcrumb.to}
            title={`Back to ${breadcrumb.label} (L)`}
            className="-ml-3 min-w-0 truncate border-l border-gray-300 pl-5 text-sm text-gray-600 hover:text-black"
          >
            ‹ {breadcrumb.label}
          </Link>
        )}
        {/* The generation queue, on every page so it's easy to find, and
            so a pause isn't forgotten about. The icon shows the state:
            a list when empty, turning arrows while generating, a pause
            sign when paused. */}
        <button
          onClick={generation.toggleQueue}
          title={queueTitle}
          data-queue-toggle
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
            generation.queueOpen
              ? "border-black text-black"
              : "border-gray-300 text-gray-600 hover:border-black hover:text-black"
          }`}
        >
          {queued === 0 ? (
            <ListIcon />
          ) : generation.paused ? (
            <PausedIcon />
          ) : (
            <GeneratingIcon />
          )}
          {queued > 0 && generation.paused ? "Paused" : "Queue"}
          {queued > 0 && ` · ${queued}`}
        </button>
        <button
          onClick={togglePanel}
          title="Preferences (P)"
          aria-label="Preferences"
          data-preferences-toggle
          className="text-lg text-gray-600 hover:text-black"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
