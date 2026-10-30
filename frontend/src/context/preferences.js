import { createContext, useContext } from "react";

// Kept in the same shape as the backend's Preferences schema, with the same
// defaults, which are used until the saved preferences have loaded.
export const DEFAULTS = {
  theme: "auto",
  font: "sans",
  font_size: 18,
  align: "left",
  hyphenate: false,
  page_width: "normal",
  highlight_words: true,
  highlight_color: "yellow",
  recent_voices: [],
};

// Fonts that come with the operating system, so nothing is downloaded.
export const FONTS = {
  sans: {
    label: "Sans-serif",
    family: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
  },
  serif: {
    label: "Serif (Georgia)",
    family: 'Georgia, Cambria, "Times New Roman", serif',
  },
  book: {
    label: "Book (Palatino)",
    family: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  },
  verdana: {
    label: "Verdana (extra legible)",
    family: "Verdana, Tahoma, sans-serif",
  },
};

// How wide the reading page may get. Full still keeps the page's padding.
export const PAGE_WIDTHS = {
  normal: { label: "Normal", className: "max-w-2xl" },
  wide: { label: "Wide", className: "max-w-5xl" },
  full: { label: "Full", className: "max-w-none" },
};

// Highlights are see-through tints of these colors (red green blue), so
// they work on light, dark and paper backgrounds alike.
export const HIGHLIGHT_COLORS = {
  yellow: "250 204 21",
  green: "34 197 94",
  blue: "59 130 246",
  pink: "236 72 153",
};

const CACHE_KEY = "preferences";

// A copy in the browser, so the theme is right on the very first paint
// instead of flashing light until the server answers.
export function cachedPreferences() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CACHE_KEY)) };
  } catch {
    return DEFAULTS;
  }
}

export function cachePreferences(prefs) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable; the server copy still applies on load
  }
}

// "auto" follows the operating system's light/dark setting.
export function applyTheme(theme) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme =
    theme === "auto" ? (dark ? "dark" : "light") : theme;
}

export const PreferencesContext = createContext(null);

export const usePreferences = () => useContext(PreferencesContext);
