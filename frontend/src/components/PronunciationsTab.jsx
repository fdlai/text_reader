import { useEffect, useState } from "react";
import {
  createPronunciation,
  deletePronunciation,
  listPronunciations,
  previewVoice,
  updatePronunciation,
} from "../api";

const EMPTY = { word: "", sounds_like: "" };

// Said twice so a short name is easy to hear.
const sample = (text) => `${text}. Once more: ${text}.`;

// prefill: { word } from "Fix pronunciation". The panel gives this tab a new
// key for each prefill, so it starts fresh and applies it once on load.
// voice: the Reader's selected voice preset, used for previews.
// onChange: called after entries change, so the Reader can recheck which
// audio is outdated.
export default function PronunciationsTab({ prefill, voice, onChange }) {
  const [entries, setEntries] = useState(null); // null until loaded
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    listPronunciations()
      .then((list) => {
        setEntries(list);
        if (!prefill) return;
        // Prefilling a word that already has an entry edits that entry.
        const existing = list.find(
          (e) => e.word.toLowerCase() === prefill.word.toLowerCase(),
        );
        if (existing) {
          setEditingId(existing.id);
          setForm({ word: existing.word, sounds_like: existing.sounds_like });
        } else {
          setForm({ word: prefill.word, sounds_like: prefill.word });
        }
      })
      .catch((e) => setError(e.message));
  }, [prefill]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function refresh() {
    setEntries(await listPronunciations());
    onChange();
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function handlePreview(text) {
    if (!voice) return;
    setError("");
    setPreviewing(true);
    try {
      const blob = await previewVoice({
        engine: voice.engine,
        base_voice: voice.base_voice,
        instructions: voice.instructions,
        text: sample(text),
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

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        const entry = entries.find((x) => x.id === editingId);
        await updatePronunciation(editingId, { ...form, enabled: entry.enabled });
      } else {
        await createPronunciation(form);
      }
      reset();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggle(entry) {
    setError("");
    try {
      await updatePronunciation(entry.id, { ...entry, enabled: !entry.enabled });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(entry) {
    if (!confirm(`Delete the pronunciation for "${entry.word}"?`)) return;
    setError("");
    try {
      await deletePronunciation(entry.id);
      if (editingId === entry.id) reset();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className="space-y-3">
        <h3 className="font-medium">
          {editingId ? "Edit pronunciation" : "Add pronunciation"}
        </h3>
        <input
          value={form.word}
          onChange={set("word")}
          placeholder="Word or name, e.g. Chung Myung"
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        <input
          value={form.sounds_like}
          onChange={set("sounds_like")}
          placeholder="Sounds like, e.g. Chung Myoong"
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        <p className="text-xs text-gray-500">
          Spell it the way it should sound. Hyphens and capitals can help, e.g.
          "Woo-DAHNG". Previews use the voice selected in the reader
          {voice ? ` (${voice.name})` : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handlePreview(form.sounds_like)}
            disabled={previewing || !form.sounds_like.trim() || !voice}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {previewing ? "Loading..." : "▶ Preview"}
          </button>
          <button
            type="button"
            onClick={() => handlePreview(form.word)}
            disabled={previewing || !form.word.trim() || !voice}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            ▶ Original
          </button>
          <button
            type="submit"
            className="rounded bg-black px-3 py-1.5 text-sm text-white"
          >
            Save
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="px-3 py-1.5 text-sm">
              Cancel
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div>
        <h3 className="font-medium">Your pronunciations</h3>
        {!entries ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            None yet. Tip: select a word in the text and choose "Fix
            pronunciation".
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200">
            {entries.map((entry) => (
              <li key={entry.id} className="py-3">
                <p className={entry.enabled ? "" : "text-gray-400"}>
                  <span className="font-medium">{entry.word}</span> →{" "}
                  {entry.sounds_like}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                  <button
                    onClick={() => handlePreview(entry.sounds_like)}
                    disabled={previewing || !voice}
                    className="hover:text-black disabled:opacity-50"
                  >
                    ▶ Preview
                  </button>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={() => handleToggle(entry)}
                      className="accent-black"
                    />
                    On
                  </label>
                  <button
                    onClick={() => {
                      setEditingId(entry.id);
                      setForm({
                        word: entry.word,
                        sounds_like: entry.sounds_like,
                      });
                    }}
                    className="hover:text-black"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    className="hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
