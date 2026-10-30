import { useMatch } from "react-router-dom";
import {
  FONTS,
  HIGHLIGHT_COLORS,
  PAGE_WIDTHS,
  usePreferences,
} from "../context/preferences";

const THEMES = { auto: "Auto", light: "Light", dark: "Dark", paper: "Paper" };
const ALIGNMENTS = { left: "Left align", justify: "Justify" };
// { System: [[key, font], ...], Serif: [...], ... }, in the order of FONTS.
const FONT_GROUPS = Object.groupBy(
  Object.entries(FONTS),
  ([, font]) => font.group,
);

// A row of buttons where exactly one is selected.
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex rounded-lg bg-gray-100 p-1">
      {Object.entries(options).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`flex-1 rounded-md py-1.5 text-sm ${
            value === key
              ? "bg-white font-medium shadow-sm"
              : "text-gray-500 hover:text-black"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// An on/off switch with a label and a short description.
function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-black" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

// Changes apply right away and are saved automatically. Only the theme
// affects every page; the rest are about how articles look.
export default function DisplayTab() {
  const { prefs, update } = usePreferences();
  const reading = useMatch("/documents/:id");

  return (
    <div className="space-y-6">
      <Section title="Theme">
        <Segmented
          options={THEMES}
          value={prefs.theme}
          onChange={(theme) => update({ theme })}
        />
      </Section>

      {/* In the reader, changes show in the text behind the panel, so the
          note is only needed elsewhere. */}
      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Reading
        </h3>
        {!reading && (
          <p className="mt-1 text-sm text-gray-500">
            These apply when you open an article.
          </p>
        )}
      </div>

      <Section title="Font">
        <select
          value={prefs.font}
          onChange={(e) => update({ font: e.target.value })}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2"
        >
          {Object.entries(FONT_GROUPS).map(([group, fonts]) => (
            <optgroup key={group} label={group}>
              {fonts.map(([key, { label, family }]) => (
                <option key={key} value={key} style={{ fontFamily: family }}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Section>

      <Section title={`Font size: ${prefs.font_size}px`}>
        <input
          type="range"
          min={12}
          max={60}
          value={prefs.font_size}
          onChange={(e) => update({ font_size: Number(e.target.value) })}
          className="w-full accent-black"
        />
      </Section>

      <Section title="Page width">
        <Segmented
          options={Object.fromEntries(
            Object.entries(PAGE_WIDTHS).map(([key, { label }]) => [key, label]),
          )}
          value={prefs.page_width}
          onChange={(page_width) => update({ page_width })}
        />
      </Section>

      <Section title="Text alignment">
        <Segmented
          options={ALIGNMENTS}
          value={prefs.align}
          onChange={(align) => update({ align })}
        />
        <Toggle
          label="Hyphenate words"
          description="Split long words at the end of a line, for more even spacing"
          checked={prefs.hyphenate}
          onChange={(hyphenate) => update({ hyphenate })}
        />
      </Section>

      <Section title="Highlight">
        <Toggle
          label="Highlight words"
          description="While reading, highlight the current word"
          checked={prefs.highlight_words}
          onChange={(highlight_words) => update({ highlight_words })}
        />
      </Section>

      <Section title="Highlight color">
        <div className="flex gap-3">
          {Object.entries(HIGHLIGHT_COLORS).map(([key, rgb]) => (
            <button
              key={key}
              onClick={() => update({ highlight_color: key })}
              aria-label={key}
              aria-pressed={prefs.highlight_color === key}
              style={{ backgroundColor: `rgb(${rgb} / 0.45)` }}
              className={`h-8 w-8 rounded-full ${
                prefs.highlight_color === key
                  ? "ring-2 ring-black ring-offset-2 ring-offset-white"
                  : ""
              }`}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
