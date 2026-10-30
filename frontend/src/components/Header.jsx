import { useEffect, useState } from "react";
import { Link, useMatch } from "react-router-dom";
import { useBreadcrumb } from "../context/breadcrumb";
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

// The bar at the top of every page. It slides out of view while scrolling
// down, so the text gets the whole screen, and comes back on scrolling up.
export default function Header() {
  const { togglePanel } = usePreferences();
  const { breadcrumb } = useBreadcrumb();
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
        <button
          onClick={togglePanel}
          title="Preferences (P)"
          aria-label="Preferences"
          data-preferences-toggle
          className="ml-auto text-lg text-gray-600 hover:text-black"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
