import { useEffect, useRef, useState } from "react";
import {
  createCustomVoice,
  customVoiceSampleUrl,
  deleteCustomVoice,
  designVoice,
  listCustomVoices,
} from "../api";
import { useEngines } from "../useEngines";
import EngineNotice from "./EngineNotice";

const EXAMPLE =
  "Realistic male voice in the 30s age with american accent. Normal pitch, warm timbre, conversational pacing, audiobook narrator.";

// The server expects the sample as base64 text inside the JSON body.
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Designing a voice: describe it, generate samples ("takes") until one
// sounds right, then name and save it. Every take is a different voice,
// so earlier takes stay listed to compare against.
export default function CreateVoiceTab() {
  const [saved, setSaved] = useState([]);
  const [description, setDescription] = useState(EXAMPLE);
  const [takes, setTakes] = useState([]); // [{ n, blob, url, description }], newest first
  const [selected, setSelected] = useState(null); // take n
  const [name, setName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { engines, checking, recheck } = useEngines();
  const audioRef = useRef(null);
  const takesRef = useRef(takes);

  useEffect(() => {
    listCustomVoices()
      .then(setSaved)
      .catch((e) => setError(e.message));
  }, []);

  // Blob URLs hold the audio in memory until revoked.
  useEffect(() => {
    takesRef.current = takes;
  }, [takes]);
  useEffect(
    () => () => takesRef.current.forEach((t) => URL.revokeObjectURL(t.url)),
    [],
  );

  function play(url) {
    audioRef.current?.pause();
    audioRef.current = new Audio(url);
    audioRef.current.play().catch((e) => setError(e.message));
  }

  async function handleGenerate() {
    setError("");
    setGenerating(true);
    try {
      const blob = await designVoice(description);
      const take = {
        n: (takes[0]?.n ?? 0) + 1,
        blob,
        url: URL.createObjectURL(blob),
        description,
      };
      setTakes([take, ...takes]);
      setSelected(take.n);
      play(take.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const take = takes.find((t) => t.n === selected);
    if (!take) return;
    setError("");
    setNotice("");
    try {
      const voice = await createCustomVoice({
        name,
        description: take.description,
        sample_b64: await toBase64(take.blob),
      });
      setSaved((vs) =>
        [...vs, voice].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName("");
      setNotice(`Saved "${voice.name}". You can now pick it in the Reader.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(voice) {
    if (
      !confirm(
        `Delete the voice "${voice.name}"? Its voice preset and all audio generated with it will be deleted too.`,
      )
    )
      return;
    setError("");
    setNotice("");
    try {
      await deleteCustomVoice(voice.id);
      setSaved((vs) => vs.filter((v) => v.id !== voice.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm text-gray-600">
          Describe a voice (age, accent, pitch, tone, pacing) and generate a
          sample. Each sample is a different voice, so generate a few and keep
          the one you like. Uses Qwen, free, running on your computer.
        </p>
        <EngineNotice
          status={engines?.qwen}
          checking={checking}
          onRecheck={recheck}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        <button
          onClick={handleGenerate}
          disabled={
            generating ||
            !description.trim() ||
            engines?.qwen.available === false
          }
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate sample"}
        </button>
        {generating && takes.length === 0 && (
          <p className="text-sm text-gray-500">
            The first sample can take up to a minute while the voice model
            starts.
          </p>
        )}
      </section>

      {takes.length > 0 && (
        <form onSubmit={handleSave} className="space-y-3">
          <h2 className="text-xl font-semibold">Samples</h2>
          <ul className="divide-y divide-gray-200">
            {takes.map((take) => (
              <li key={take.n} className="flex items-center gap-3 py-2">
                <input
                  type="radio"
                  name="take"
                  checked={selected === take.n}
                  onChange={() => setSelected(take.n)}
                  aria-label={`Select sample ${take.n}`}
                />
                <button
                  type="button"
                  onClick={() => play(take.url)}
                  className="text-sm text-gray-600 hover:text-black"
                >
                  ▶ Sample {take.n}
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-500">
                  {take.description}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name for the selected sample"
              maxLength={100}
              required
              className="flex-1 rounded border border-gray-300 px-3 py-2"
            />
            <button
              type="submit"
              className="rounded bg-black px-4 py-2 text-white"
            >
              Save voice
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-red-600">{error}</p>}
      {notice && <p className="text-green-700">{notice}</p>}

      <section>
        <h2 className="text-xl font-semibold">My voices</h2>
        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No saved voices yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200">
            {saved.map((voice) => (
              <li key={voice.id} className="flex items-center gap-4 py-3">
                <button
                  onClick={() => play(customVoiceSampleUrl(voice.id))}
                  className="text-sm text-gray-600 hover:text-black"
                >
                  ▶
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{voice.name}</p>
                  <p className="truncate text-sm text-gray-500">
                    {voice.description}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(voice)}
                  className="text-sm text-gray-500 hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
