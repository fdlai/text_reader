import { useEffect, useState } from "react";
import {
  createVoice,
  deleteVoice,
  listEngineVoices,
  listVoices,
  previewVoice,
  updateVoice,
} from "../api";
import CreateVoiceTab from "../components/CreateVoiceTab";
import EngineNotice from "../components/EngineNotice";
import { ENGINE_TAGS, ENGINES } from "../engines";
import { useEngines } from "../useEngines";

const TABS = { presets: "Voice presets", create: "Create a voice" };

const SAMPLE =
  "The old road wound through the mountains, and the traveler paused to listen to the wind.";

const EMPTY = {
  name: "",
  engine: "kokoro",
  base_voice: "am_michael",
  instructions: "",
  speed: 1,
};

export default function Voices() {
  const [voices, setVoices] = useState([]);
  // { engine: [{ id, label }] }
  const [engineVoices, setEngineVoices] = useState({
    kokoro: [],
    openai: [],
    qwen: [],
  });
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [sample, setSample] = useState(SAMPLE);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [tab, setTab] = useState("presets");
  const { engines, checking, recheck } = useEngines();

  // Reloaded on returning to this tab, since saving or deleting a voice on
  // the other tab also adds or removes its preset.
  useEffect(() => {
    if (tab !== "presets") return;
    Promise.all([listVoices(), listEngineVoices()])
      .then(([v, ev]) => {
        setVoices(v);
        setEngineVoices(ev);
      })
      .catch((e) => setError(e.message));
  }, [tab]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const voiceLabel = (engine, id) =>
    engineVoices[engine].find((v) => v.id === id)?.label ?? id;

  // Each engine has its own voices, so switching engine picks that engine's first voice.
  function setEngine(e) {
    const engine = e.target.value;
    setForm({ ...form, engine, base_voice: engineVoices[engine][0]?.id ?? "" });
  }

  function edit(voice) {
    setEditingId(voice.id);
    setForm({
      name: voice.name,
      engine: voice.engine,
      base_voice: voice.base_voice,
      instructions: voice.instructions,
      speed: voice.speed,
    });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    const payload = { ...form, speed: Number(form.speed) };
    try {
      if (editingId) {
        const saved = await updateVoice(editingId, payload);
        setVoices((vs) => vs.map((v) => (v.id === saved.id ? saved : v)));
      } else {
        const saved = await createVoice(payload);
        setVoices((vs) => [...vs, saved]);
      }
      reset();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(voice) {
    if (!confirm(`Delete "${voice.name}" and all audio generated with it?`))
      return;
    try {
      await deleteVoice(voice.id);
      setVoices((vs) => vs.filter((v) => v.id !== voice.id));
      if (editingId === voice.id) reset();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePreview() {
    setError("");
    setPreviewing(true);
    try {
      const blob = await previewVoice({
        engine: form.engine,
        base_voice: form.base_voice,
        instructions: form.instructions,
        text: sample,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold">Voices</h1>

      <div className="mt-4 flex gap-4 border-b border-gray-200">
        {Object.entries(TABS).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 pb-2 text-sm ${
              tab === id
                ? "border-black font-medium"
                : "border-transparent text-gray-500 hover:text-black"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "create" ? (
        <div className="mt-6">
          <CreateVoiceTab />
        </div>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-gray-200">
            {voices.map((voice) => (
              <li
                key={voice.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {voice.name}{" "}
                    <span className="text-sm font-normal text-gray-500">
                      ({ENGINE_TAGS[voice.engine]},{" "}
                      {voiceLabel(voice.engine, voice.base_voice)})
                    </span>
                  </p>
                  {voice.engine === "openai" && (
                    <p className="truncate text-sm text-gray-500">
                      {voice.instructions || "No style instructions"}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => edit(voice)}
                  className="text-sm text-gray-500 hover:text-black"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(voice)}
                  className="text-sm text-gray-500 hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>

          <form onSubmit={handleSave} className="mt-8 space-y-3">
            <h2 className="text-xl font-semibold">
              {editingId ? "Edit voice" : "New voice"}
            </h2>
            <input
              value={form.name}
              onChange={set("name")}
              placeholder="Name"
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
            <select
              value={form.engine}
              onChange={setEngine}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              {Object.entries(ENGINES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                  {engines?.[value].available === false && " (unavailable)"}
                </option>
              ))}
            </select>
            <EngineNotice
              status={engines?.[form.engine]}
              checking={checking}
              onRecheck={recheck}
            />
            <select
              value={form.base_voice}
              onChange={set("base_voice")}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              {engineVoices[form.engine].map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            {form.engine === "qwen" && engineVoices.qwen.length === 0 && (
              <p className="text-sm text-amber-700">
                You have no saved voices yet. Make one on the Create a voice tab
                first.
              </p>
            )}
            {form.engine === "openai" && (
              <textarea
                value={form.instructions}
                onChange={set("instructions")}
                placeholder="Style instructions, e.g. warm, calm narrator with a slightly slow pace"
                rows={3}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            )}
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Default playback speed
              <input
                type="number"
                step="0.05"
                min="0.5"
                max="3"
                value={form.speed}
                onChange={set("speed")}
                className="w-20 rounded border border-gray-300 px-2 py-1"
              />
            </label>
            <textarea
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            {editingId && (
              <p className="text-sm text-amber-700">
                Changing the engine, voice or instructions deletes audio already
                generated with this voice.
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreview}
                disabled={
                  previewing ||
                  !sample.trim() ||
                  !form.base_voice ||
                  engines?.[form.engine].available === false
                }
                className="rounded border border-gray-300 px-4 py-2 disabled:opacity-50"
              >
                {previewing ? "Loading..." : "Preview"}
              </button>
              <button
                type="submit"
                disabled={!form.base_voice}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Save
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="px-4 py-2">
                  Cancel
                </button>
              )}
            </div>
            {error && <p className="text-red-600">{error}</p>}
          </form>
        </>
      )}
    </div>
  );
}
