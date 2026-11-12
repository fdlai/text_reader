import { useEffect, useRef, useState } from "react";
import { listVoices, pausePreview } from "../api";
import { usePlayer } from "../context/PlayerContext";
import {
  MAX_PAUSE,
  PAUSE_PRESETS,
  PAUSE_STEP,
  toPauseStep,
  usePreferences,
} from "../context/preferences";
import { Section } from "./DisplayTab";
import {
  defaultVoiceId,
  ENGINE_NAMES,
  kokoroDetail,
  sortVoices,
} from "../engines";

const seconds = (value) => `${value.toFixed(2)} s`;

// Settings for how audio is made. Unlike the Display settings they're
// baked into the audio, so they apply to audio generated from now on.
// voice: the Reader's selected voice preset, used for previews.
// onChange() is called once a change is saved (only from the Reader, so it
// can show which of its sections were made with the old setting).
export default function ListeningTab({ voice, onChange }) {
  const { prefs, update } = usePreferences();
  // The slider's value while it's being moved. It's saved once the slider
  // stops for a moment, rather than at every step it passes through.
  const [draft, setDraft] = useState(null);
  const pause = draft ?? prefs.paragraph_pause;

  function save(value) {
    update({ paragraph_pause: value }, { saveNow: true })
      .then(() => onChange?.())
      .catch(() => {});
  }

  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => {
      save(draft);
      setDraft(null);
    }, 400);
    return () => clearTimeout(timer);
    // Only the draft matters: save always does the same thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function choosePreset(value) {
    setDraft(null);
    save(value);
  }

  // The preview: "loading" while its audio is made, "playing", or null.
  const [previewState, setPreviewState] = useState(null);
  const [error, setError] = useState("");
  const audioRef = useRef(null);
  // Counts previews started or stopped, so a preview that finishes loading
  // after being stopped (or replaced) doesn't start playing.
  const runRef = useRef(0);
  const player = usePlayer();

  function stopPreview() {
    runRef.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewState(null);
  }

  // Stop when the panel closes or the tab changes, including a preview
  // still loading: counting this as a stop keeps it from playing once its
  // audio arrives.
  useEffect(
    () => () => {
      runRef.current++;
      audioRef.current?.pause();
    },
    [],
  );

  async function startPreview() {
    const run = ++runRef.current;
    setError("");
    setPreviewState("loading");
    // So the article and the preview don't talk over each other.
    if (player.playing) player.toggle();
    try {
      const blob = await pausePreview(voice.id, pause);
      if (run !== runRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (run === runRef.current) setPreviewState(null);
      };
      await audio.play();
      if (run === runRef.current) setPreviewState("playing");
    } catch (e) {
      if (run !== runRef.current) return;
      setError(e.message);
      setPreviewState(null);
    }
  }

  const canPreview = voice && voice.engine !== "openai";

  const [voices, setVoices] = useState(null);
  useEffect(() => {
    listVoices()
      .then(setVoices)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <Section title="Default voice">
        {voices ? (
          <select
            value={defaultVoiceId(voices, prefs.default_voice) ?? ""}
            onChange={(e) => update({ default_voice: Number(e.target.value) })}
            aria-label="Default voice"
            className="w-full rounded border border-gray-300 px-2 py-1.5"
          >
            {Object.keys(ENGINE_NAMES).map((engine) => (
              <optgroup key={engine} label={ENGINE_NAMES[engine]}>
                {sortVoices(voices, engine).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.engine === "kokoro"
                      ? `${v.name} (${kokoroDetail(v.base_voice)})`
                      : v.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <p className="text-sm text-gray-500">Loading...</p>
        )}
        <p className="text-xs text-gray-500">
          New articles start with this voice. Articles you&apos;ve already
          played or generated keep the voice you used, and the next part of a
          story is generated with the voice of the part before it.
        </p>
      </Section>

      <Section title={`Pause between paragraphs: ${seconds(pause)}`}>
        <div className="flex rounded-lg bg-gray-100 p-1">
          {PAUSE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => choosePreset(preset.seconds)}
              className={`flex-1 rounded-md py-1.5 text-sm ${
                pause === preset.seconds
                  ? "bg-white font-medium shadow-sm"
                  : "text-gray-500 hover:text-black"
              }`}
            >
              {preset.label}
              <span className="block text-xs font-normal text-gray-500">
                {seconds(preset.seconds)}
              </span>
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={MAX_PAUSE}
          step={PAUSE_STEP}
          value={pause}
          onChange={(e) => setDraft(toPauseStep(Number(e.target.value)))}
          aria-label="Pause between paragraphs, in seconds"
          className="w-full accent-black"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>{seconds(0)}</span>
          <span>{seconds(MAX_PAUSE)}</span>
        </div>
        <p className="text-xs text-gray-500">
          In a story, a new paragraph often means someone else is speaking. A
          longer pause makes that easier to hear. Short (0.35 s) is the default.
        </p>
      </Section>

      <Section title="Preview">
        <button
          onClick={previewState ? stopPreview : startPreview}
          disabled={!canPreview}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:border-black disabled:opacity-40 disabled:hover:border-gray-300"
        >
          {previewState === "loading"
            ? "Preparing… (Stop)"
            : previewState === "playing"
              ? "■ Stop"
              : `▶ Hear ${seconds(pause)}`}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-gray-500">
          {!voice
            ? "To hear a preview, open an article: it uses the voice selected there."
            : voice.engine === "openai"
              ? `Previews use the voice selected in the reader, and OpenAI voices (like ${voice.name}) don't add these pauses.`
              : `A short conversation read by the voice selected in the reader (${voice.name}). The first preview for a voice takes a few seconds to make, longer for Qwen if it isn't running yet.`}
        </p>
      </Section>

      <p className="text-xs text-gray-500">
        Applies to Kokoro and Qwen voices, for audio generated from now on.
        Articles with audio made with a different pause offer to regenerate it.
        OpenAI voices don't add these pauses.
      </p>
    </div>
  );
}
