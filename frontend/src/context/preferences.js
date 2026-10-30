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

// "System" fonts come with the operating system, so they load instantly but
// look slightly different on each one. The others are downloaded from
// public/fonts (see src/fonts.css), only once chosen, and look the same
// everywhere. Groups become sections of the Font dropdown.
export const FONTS = {
  sans: {
    label: "Sans-serif",
    group: "System",
    family: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
  },
  serif: {
    label: "Serif (Georgia)",
    group: "System",
    family: 'Georgia, Cambria, "Times New Roman", serif',
  },
  book: {
    label: "Book (Palatino)",
    group: "System",
    family: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  },
  verdana: {
    label: "Verdana (extra legible)",
    group: "System",
    family: "Verdana, Tahoma, sans-serif",
  },
  literata: { label: "Literata", group: "Serif", family: "Literata, serif" },
  merriweather: {
    label: "Merriweather",
    group: "Serif",
    family: "Merriweather, serif",
  },
  source_serif: {
    label: "Source Serif",
    group: "Serif",
    family: '"Source Serif 4", serif',
  },
  garamond: {
    label: "EB Garamond",
    group: "Serif",
    family: '"EB Garamond", serif',
  },
  lora: { label: "Lora", group: "Serif", family: "Lora, serif" },
  inter: { label: "Inter", group: "Sans-serif", family: "Inter, sans-serif" },
  atkinson: {
    label: "Atkinson Hyperlegible",
    group: "Sans-serif",
    family: '"Atkinson Hyperlegible", sans-serif',
  },
  lexend: {
    label: "Lexend",
    group: "Sans-serif",
    family: "Lexend, sans-serif",
  },
  nunito: {
    label: "Nunito",
    group: "Sans-serif",
    family: "Nunito, sans-serif",
  },
  opendyslexic: {
    label: "OpenDyslexic",
    group: "Specialty",
    family: "OpenDyslexic, sans-serif",
  },
  ia_writer: {
    label: "iA Writer Quattro",
    group: "Specialty",
    family: '"iA Writer Quattro", sans-serif',
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
