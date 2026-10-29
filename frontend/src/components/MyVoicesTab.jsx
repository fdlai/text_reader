import { useEffect, useState } from "react";
import {
  deleteCustomVoice,
  deleteVoice,
  listCustomVoices,
  listVoices,
  renameVoice,
} from "../api";
import { useConfirm } from "../context/confirm";
import { ENGINE_NAMES } from "../engines";
import { useSamplePlayer } from "../useSamplePlayer";

// The voices the user has made (Qwen and OpenAI), with preview, rename,
// edit (OpenAI only) and delete. Kokoro's voices are built in, so they
// aren't listed.
// onEdit(voice): open an OpenAI voice in the Create tab's form.
// onCreate(): go to the Create tab.
export default function MyVoicesTab({ onEdit, onCreate }) {
  const [voices, setVoices] = useState(null); // null until loaded
  // Qwen voices' descriptions, by saved voice id.
  const [descriptions, setDescriptions] = useState({});
  // The voice being renamed: { id, name }, or null.
  const [renaming, setRenaming] = useState(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const samples = useSamplePlayer();

  function load() {
    return Promise.all([listVoices(), listCustomVoices()])
      .then(([v, custom]) => {
        setVoices(
          v
            .filter((voice) => voice.engine !== "kokoro")
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setDescriptions(
          Object.fromEntries(custom.map((c) => [String(c.id), c.description])),
        );
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  function detail(voice) {
    if (voice.engine === "qwen") return descriptions[voice.base_voice] ?? "";
    return voice.instructions
      ? `Based on ${voice.base_voice} · ${voice.instructions}`
      : `Based on ${voice.base_voice}`;
  }

  async function saveName(e) {
    e.preventDefault();
    setError("");
    try {
      const saved = await renameVoice(renaming.id, renaming.name);
      setVoices((vs) => vs.map((v) => (v.id === saved.id ? saved : v)));
      setRenaming(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(voice) {
    const confirmed = await confirm({
      title: "Delete voice?",
      message: `"${voice.name}" will be removed, along with all audio generated with it.`,
    });
    if (!confirmed) return;
    setError("");
    samples.stop();
    try {
      // A Qwen voice is deleted through its saved recording, which also
      // removes it from the Reader.
      if (voice.engine === "qwen") {
        await deleteCustomVoice(Number(voice.base_voice));
      } else {
        await deleteVoice(voice.id);
      }
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-500">
        Kokoro's voices are built in: pick them from the voice menu on any
        article.
      </p>

      {(error || samples.error) && (
        <p className="mt-3 text-red-600">{error || samples.error}</p>
      )}

      {voices?.length === 0 && (
        <p className="mt-6 text-gray-500">
          You haven't made any voices yet.{" "}
          <button onClick={onCreate} className="underline hover:text-black">
            Create one
          </button>
        </p>
      )}

      <ul className="mt-4 divide-y divide-gray-200">
        {voices?.map((voice) => {
          const state =
            samples.previewing?.id === voice.id ? samples.previewing : null;
          return (
            <li key={voice.id} className="flex items-center gap-3 py-3">
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

              <div className="min-w-0 flex-1">
                {renaming?.id === voice.id ? (
                  <form onSubmit={saveName} className="flex gap-2">
                    <input
                      value={renaming.name}
                      onChange={(e) =>
                        setRenaming({ ...renaming, name: e.target.value })
                      }
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      maxLength={100}
                      required
                      autoFocus
                      aria-label="New name"
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1"
                    />
                    <button type="submit" className="text-sm font-medium">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      className="text-sm text-gray-500 hover:text-black"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <p className="font-medium">
                    {voice.name}{" "}
                    <span className="text-sm font-normal text-gray-500">
                      {ENGINE_NAMES[voice.engine]}
                    </span>
                  </p>
                )}
                <p className="truncate text-sm text-gray-500">
                  {detail(voice)}
                </p>
              </div>

              {renaming?.id !== voice.id && (
                <button
                  onClick={() =>
                    setRenaming({ id: voice.id, name: voice.name })
                  }
                  className="text-sm text-gray-500 hover:text-black"
                >
                  Rename
                </button>
              )}
              {voice.engine === "openai" && (
                <button
                  onClick={() => onEdit(voice)}
                  className="text-sm text-gray-500 hover:text-black"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => handleDelete(voice)}
                className="text-sm text-gray-500 hover:text-red-600"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
