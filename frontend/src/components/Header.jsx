import { useEffect, useState } from "react";
import { Link, useMatch } from "react-router-dom";
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
  const reading = useMatch("/documents/:id");
  const library = useMatch("/");
  const voices = useMatch("/voices");
  const hidden = useScrollingDown();

  // An article counts as being in the Library, so Library stays highlighted.
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
            title={reading ? "Library (L)" : undefined}
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
        {/* The Preferences panel belongs to the article page. */}
        {reading && (
          <button
            onClick={togglePanel}
            title="Preferences (P)"
            aria-label="Preferences"
            className="ml-auto text-lg text-gray-600 hover:text-black"
          >
            ⚙
          </button>
        )}
      </div>
    </header>
  );
}
