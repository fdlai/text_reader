import { useEffect, useRef, useState } from "react";
import {
  createVoice,
  listEngineVoices,
  previewVoice,
  updateVoice,
} from "../api";
import { useConfirm } from "../context/confirm";
import EngineNotice from "./EngineNotice";

const EXAMPLE =
  "Speak in a warm, natural, steady narrator voice at a relaxed pace. Keep the tone consistent throughout.";

// The server expects the sample as base64 text inside the JSON body.
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// An OpenAI voice: one of OpenAI's voices plus instructions for how it
// should speak. Unlike Qwen, the voice is the settings, not a recording, so
// the same settings always sound alike.
// editing: a saved OpenAI voice to change, or null to create a new one.
// onDone: called after saving changes or cancelling an edit.
export default function OpenAIVoiceForm({
  engines: { engines, checking, recheck },
  editing,
  onDone,
}) {
  const [baseVoices, setBaseVoices] = useState([]);
  const [baseVoice, setBaseVoice] = useState(editing?.base_voice ?? "coral");
  const [instructions, setInstructions] = useState(
    editing?.instructions ?? EXAMPLE,
  );
  const [name, setName] = useState(editing?.name ?? "");
  // The last preview: { key, blob, url }, where key records the settings it
  // was made with. Replaying it is free; it's also saved as the voice's
  // sample if the settings haven't changed since.
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const confirm = useConfirm();
  const audioRef = useRef(null);
  const previewRef = useRef(preview);

  useEffect(() => {
    listEngineVoices()
      .then((v) => setBaseVoices(v.openai.map((x) => x.id)))
      .catch((e) => setError(e.message));
  }, []);

  // Blob URLs hold the audio in memory until revoked.
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    },
    [],
  );

  const key = `${baseVoice}|${instructions}`;
  const unavailable = engines?.openai.available === false;

  function play(url) {
    audioRef.current?.pause();
    audioRef.current = new Audio(url);
    audioRef.current.play().catch((e) => setError(e.message));
  }

  async function handlePreview() {
    if (preview?.key === key) {
      play(preview.url);
      return;
    }
    setError("");
    setPreviewing(true);
    try {
      const blob = await previewVoice({
        engine: "openai",
        base_voice: baseVoice,
        instructions,
      });
      if (preview) URL.revokeObjectURL(preview.url);
      const next = { key, blob, url: URL.createObjectURL(blob) };
      setPreview(next);
      play(next.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  // The settings to save, with the preview as the sample if it matches.
  async function voiceData(speed) {
    return {
      name,
      engine: "openai",
      base_voice: baseVoice,
      instructions,
      speed,
      sample_b64: preview?.key === key ? await toBase64(preview.blob) : null,
    };
  }

  async function saveNew() {
    setError("");
    setNotice("");
    try {
      const voice = await createVoice(await voiceData(editing?.speed ?? 1));
      if (editing) {
        onDone();
      } else {
        setName("");
        setNotice(`Saved "${voice.name}". You can now pick it in the Reader.`);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveChanges() {
    const soundChanged =
      baseVoice !== editing.base_voice || instructions !== editing.instructions;
    if (
      soundChanged &&
      !(await confirm({
        title: `Change how "${editing.name}" sounds?`,
        message:
          "Audio already made with this voice will be deleted, and articles will need to generate it again.",
        confirmLabel: "Update voice",
      }))
    ) {
      return;
    }
    setError("");
    try {
      await updateVoice(editing.id, await voiceData(editing.speed));
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (editing) saveChanges();
    else saveNew();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-600">
        Pick one of OpenAI's voices and describe how it should speak (tone,
        pace, emotion). Paid: about 1.5 cents per minute of audio.
      </p>
      <EngineNotice
        status={engines?.openai}
        checking={checking}
        onRecheck={recheck}
      />

      <label className="block space-y-1">
        <span className="text-sm font-medium">Base voice</span>
        <select
          value={baseVoice}
          onChange={(e) => setBaseVoice(e.target.value)}
          className="block w-full rounded border border-gray-300 px-3 py-2"
        >
          {baseVoices.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">How it should speak</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          maxLength={2000}
          className="block w-full rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewing || unavailable}
          className="rounded border border-gray-300 px-4 py-2 disabled:opacity-50"
        >
          {previewing ? "Generating..." : "▶ Preview"}
        </button>
        <span className="text-sm text-gray-500">
          {preview?.key === key
            ? "Replaying is free."
            : "Each new preview costs about a quarter of a cent."}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          maxLength={100}
          required
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded bg-black px-4 py-2 text-white">
          {editing ? "Save changes" : "Save voice"}
        </button>
        {editing && (
          <>
            <button
              type="button"
              onClick={(e) => {
                // Still check the name is filled in, like a submit would.
                if (e.currentTarget.form.reportValidity()) saveNew();
              }}
              className="rounded border border-gray-300 px-4 py-2"
            >
              Save as new voice
            </button>
            <button type="button" onClick={onDone} className="px-2 py-2">
              Cancel
            </button>
          </>
        )}
      </div>

      {error && <p className="text-red-600">{error}</p>}
      {notice && <p className="text-green-700">{notice}</p>}
    </form>
  );
}
