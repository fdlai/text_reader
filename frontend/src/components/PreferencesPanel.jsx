import { useEffect, useState } from "react";
import DisplayTab from "./DisplayTab";
import ListeningTab from "./ListeningTab";
import PanelBackdrop from "./PanelBackdrop";
import PronunciationsTab from "./PronunciationsTab";

const TABS = [
  { id: "display", label: "Display" },
  { id: "listening", label: "Listening" },
  { id: "pronunciations", label: "Pronunciations" },
];

// A panel that slides over the right side of the page, so preferences can
// be changed while listening. "Fix pronunciation" opens it with a prefill,
// which starts it on the Pronunciations tab. voice and onAudioChange
// (called after a change that affects generated audio) only come from the
// Reader.
export default function PreferencesPanel({
  onClose,
  prefill,
  voice,
  onAudioChange,
}) {
  const [tab, setTab] = useState(prefill ? "pronunciations" : "display");

  // Close on Escape, except in a confirmation dialog (e.g. one opened from
  // this panel), where Escape closes that. Clicking outside closes it too,
  // see PanelBackdrop.
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && !e.target.closest("dialog")) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      <PanelBackdrop onClose={onClose} />
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
          {tab === "display" && <DisplayTab />}
          {tab === "listening" && (
            <ListeningTab voice={voice} onChange={onAudioChange} />
          )}
          {tab === "pronunciations" && (
            <PronunciationsTab
              key={prefill?.n ?? 0}
              prefill={prefill}
              voice={voice}
              onChange={onAudioChange}
            />
          )}
        </div>
      </aside>
    </>
  );
}
