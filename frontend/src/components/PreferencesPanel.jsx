import { useState } from "react";
import PronunciationsTab from "./PronunciationsTab";

// More tabs (e.g. Display: font, size, theme) can be added here later.
const TABS = [{ id: "pronunciations", label: "Pronunciations" }];

// A panel that slides over the right side of the reader, so preferences can
// be changed while listening.
export default function PreferencesPanel({
  onClose,
  prefill,
  voice,
  onPronunciationsChange,
}) {
  const [tab, setTab] = useState("pronunciations");

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="text-xl font-semibold">Preferences</h2>
        <button
          onClick={onClose}
          aria-label="Close preferences"
          className="text-2xl leading-none text-gray-500 hover:text-black"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex gap-4 border-b border-gray-200 px-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-2 text-sm ${
              tab === t.id
                ? "border-black font-medium"
                : "border-transparent text-gray-500 hover:text-black"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {tab === "pronunciations" && (
          <PronunciationsTab
            key={prefill?.n ?? 0}
            prefill={prefill}
            voice={voice}
            onChange={onPronunciationsChange}
          />
        )}
      </div>
    </aside>
  );
}
