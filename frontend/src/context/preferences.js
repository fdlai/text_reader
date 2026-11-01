import { createContext, useContext } from "react";

// Kept in the same shape as the backend's Preferences schema, with the same
// defaults, which are used until the saved preferences have loaded.
export const DEFAULTS = {
  theme: "auto",
  font: "sans",
  font_size: 18,
  align: "left",
  hyphenate: false,
  paragraph_spacing: "normal",
  page_width: "normal",
  highlight_words: true,
  highlight_color: "yellow",
  paragraph_pause: 0.35,
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

// The space between paragraphs, in em so it grows with the font size.
// It's added on top of the space between lines (from the line height), so
// even Compact leaves paragraphs further apart than lines.
export const PARAGRAPH_SPACINGS = {
  compact: { label: "Compact", em: 0.5 },
  normal: { label: "Normal", em: 1 },
  wide: { label: "Wide", em: 2 },
};

// How long Kokoro and Qwen voices pause after each paragraph, in seconds,
// which makes a change of speaker easier to hear. The slider goes up to
// MAX_PAUSE in steps of 0.05 s (the backend rounds to the same steps).
export const MAX_PAUSE = 2;
const PAUSE_STEPS_PER_SECOND = 20;
export const PAUSE_STEP = 1 / PAUSE_STEPS_PER_SECOND;
// Rounds to a step. Dividing (7 / 20) gives exactly 0.35, while
// multiplying (7 * 0.05) gives 0.35000000000000003, which wouldn't match
// the Short preset.
export const toPauseStep = (value) =>
  Math.round(value * PAUSE_STEPS_PER_SECOND) / PAUSE_STEPS_PER_SECOND;
export const PAUSE_PRESETS = [
  { label: "Off", seconds: 0 },
  { label: "Short", seconds: 0.35 }, // the default (DEFAULTS above)
  { label: "Medium", seconds: 0.7 },
  { label: "Long", seconds: 1 },
];

// Highlights are see-through tints of these colors (red green blue), so
// they work on light, dark and paper backgrounds alike. In rainbow order,
// with pink last: it's between purple and red, where the wheel wraps round.
export const HIGHLIGHT_COLORS = {
  red: "239 68 68",
  orange: "249 115 22",
  yellow: "250 204 21",
  green: "34 197 94",
  teal: "20 184 166",
  blue: "59 130 246",
  purple: "168 85 247",
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
