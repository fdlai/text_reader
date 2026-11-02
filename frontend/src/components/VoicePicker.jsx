import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getVoiceAudio } from "../api";
import { ENGINE_NAMES, kokoroDetail, sortVoices } from "../engines";
import { useSamplePlayer } from "../useSamplePlayer";
import EngineNotice from "./EngineNotice";

const TABS = ["kokoro", "qwen", "openai"];
const RECENT_COUNT = 4;

// The small grey text next to a voice's name.
function detail(voice) {
  if (voice.engine === "kokoro") return kokoroDetail(voice.base_voice);
  if (voice.engine === "openai") return `Based on ${voice.base_voice}`;
  return "";
}

// How much of the article a voice has audio for, e.g. "6 of 14 sections".
function audioLabel({ ready, generating }, total) {
  if (ready >= total) return "All sections";
  const sections = `${ready} of ${total} sections`;
  return generating ? `Generating · ${sections}` : sections;
}

// The Reader's voice chooser: a button showing the current voice, which
// opens a panel with the voices that have audio for this article, recently
// used voices, and a tab per engine. Every voice has a ▶ button that plays
// its saved sample clip.
export default function VoicePicker({
  voices,
  value,
  onChange,
  recent,
  engines,
  documentId,
  totalSections,
  defaultId,
  onMakeDefault,
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("kokoro");
  // The voices with audio for this article, by voice id. Loaded each time
  // the panel opens, since audio may have been made or deleted meanwhile.
  const [audio, setAudio] = useState(new Map());
  const ref = useRef(null);
  const samples = useSamplePlayer();
  const { previewing } = samples;

  const current = voices.find((v) => v.id === value);

  // Close when clicking anywhere outside, or pressing Escape.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      if (!ref.current.contains(e.target)) close();
    }
    function handleKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function toggleOpen() {
    if (open) {
      close();
    } else {
      // Start on the tab of the voice in use.
      setTab(current?.engine ?? "kokoro");
      setOpen(true);
      getVoiceAudio(documentId)
        .then((list) =>
          setAudio(new Map(list.map((a) => [a.voice_preset_id, a]))),
        )
        .catch(() => {}); // the panel still works without it
    }
  }

  function close() {
    samples.stop();
    setOpen(false);
  }

  function choose(id) {
    onChange(id);
    close();
  }

  // note is the grey text on the right; it defaults to the voice's details.
  function row(voice, note = detail(voice)) {
    const selected = voice.id === value;
    const state = previewing?.id === voice.id ? previewing : null;
    const voiceAudio = audio.get(voice.id);
    return (
      <li key={voice.id} className="flex items-center gap-1">
        <button
          onClick={() => samples.toggle(voice)}
          aria-label={
            state
              ? `Stop sample of ${voice.name}`
              : `Play sample of ${voice.name}`
          }
          title={state ? "Stop" : "Play a sample"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs text-gray-600 hover:bg-gray-100 hover:text-black"
        >
          {state ? (state.loading ? "…" : "■") : "▶"}
        </button>
        <button
          onClick={() => choose(voice.id)}
          className={`flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-gray-100 ${
            selected ? "font-medium" : ""
          }`}
        >
          <span className="truncate">
            {voice.name}
            {selected && " ✓"}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-normal text-gray-500">
            {voice.id === defaultId && (
              <span
                title="New articles start with this voice"
                className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
              >
                default
              </span>
            )}
            {voiceAudio && (
              <span
                title={`Has audio for this article: ${audioLabel(voiceAudio, totalSections).toLowerCase()}`}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
              >
                audio
              </span>
            )}
            {note}
          </span>
        </button>
      </li>
    );
  }

  // Recently used voices that still exist. Only worth showing when there's
  // more than the current one.
  const recentVoices = recent
    .map((id) => voices.find((v) => v.id === id))
    .filter(Boolean)
    .slice(0, RECENT_COUNT);
  const tabVoices = sortVoices(voices, tab);
  // Voices with audio for this article, the most complete first.
  const audioVoices = [...audio.values()]
    .sort((a, b) => b.ready - a.ready)
    .map((a) => voices.find((v) => v.id === a.voice_preset_id))
    .filter(Boolean);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2"
      >
        {current ? (
          <>
            {current.name}
            <span className="text-sm text-gray-500">
              {ENGINE_NAMES[current.engine]}
            </span>
          </>
        ) : (
          "Choose a voice"
        )}
        <span className="text-xs text-gray-500">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-2 w-80 rounded-lg border border-gray-200 bg-white text-base shadow-xl">
          {audioVoices.length > 0 && (
            <div className="border-b border-gray-200 p-2">
              <p className="px-2 pb-1 text-xs font-medium text-gray-500 uppercase">
                On this article
              </p>
              <ul>
                {audioVoices.map((v) =>
                  row(v, audioLabel(audio.get(v.id), totalSections)),
                )}
              </ul>
            </div>
          )}

          {recentVoices.length > 1 && (
            <div className="border-b border-gray-200 p-2">
              <p className="px-2 pb-1 text-xs font-medium text-gray-500 uppercase">
                Recent
              </p>
              <ul>{recentVoices.map((v) => row(v, ENGINE_NAMES[v.engine]))}</ul>
            </div>
          )}

          <div className="flex gap-4 border-b border-gray-200 px-4 pt-3">
            {TABS.map((engine) => (
              <button
                key={engine}
                onClick={() => setTab(engine)}
                className={`-mb-px border-b-2 pb-2 text-sm ${
                  tab === engine
                    ? "border-black font-medium"
                    : "border-transparent text-gray-500 hover:text-black"
                }`}
              >
                {ENGINE_NAMES[engine]}
              </button>
            ))}
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            <div className="px-2 empty:hidden">
              <EngineNotice
                status={engines.engines?.[tab]}
                checking={engines.checking}
                onRecheck={engines.recheck}
              />
            </div>
            {samples.error && (
              <p className="px-2 py-1 text-sm text-red-600">{samples.error}</p>
            )}
            {tabVoices.length > 0 ? (
              <ul>{tabVoices.map((v) => row(v))}</ul>
            ) : (
              <p className="px-2 py-3 text-sm text-gray-500">
                No {ENGINE_NAMES[tab]} voices yet.{" "}
                <Link to="/voices" className="underline hover:text-black">
                  Create one
                </Link>
              </p>
            )}
          </div>

          {current && (
            <div className="border-t border-gray-200 px-4 py-2.5 text-xs text-gray-500">
              {current.id === defaultId ? (
                `${current.name} is your default voice for new articles.`
              ) : (
                <button
                  onClick={() => onMakeDefault(current.id)}
                  className="underline hover:text-black"
                >
                  Make {current.name} the default for new articles
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
