import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createDocument, deleteDocument, listDocuments } from "../api";
import ListeningStatus from "../components/ListeningStatus";
import { useConfirm } from "../context/confirm";
import { usePlayer } from "../context/PlayerContext";

export default function Library() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const player = usePlayer();
  const confirm = useConfirm();
  const { saveNow } = player;

  // The position of whatever is playing is saved first, so its progress
  // here is up to date.
  useEffect(() => {
    saveNow()
      .then(listDocuments)
      .then(setDocuments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [saveNow]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError("");
    try {
      await createDocument(url.trim());
      // Reloaded rather than added, since the list includes each one's length.
      setDocuments(await listDocuments());
      setUrl("");
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(doc) {
    const confirmed = await confirm({
      title: "Delete article?",
      message: `"${doc.title}" will be removed, along with its audio for every voice and your listening position.`,
    });
    if (!confirmed) return;
    setError("");
    try {
      // Its audio is about to disappear, so stop it if it's playing. No
      // point saving the position of a deleted article.
      if (player.session?.documentId === doc.id) player.close(false);
      await deleteDocument(doc.id);
      setDocuments((docs) => docs.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold">Library</h1>

      <form onSubmit={handleAdd} className="mt-6 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a webpage URL"
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          required
        />
        <button
          type="submit"
          disabled={adding}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add"}
        </button>
      </form>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <ul className="mt-6 divide-y divide-gray-200">
        {loading && <li className="py-3 text-gray-500">Loading...</li>}
        {!loading && documents.length === 0 && (
          <li className="py-3 text-gray-500">No documents yet.</li>
        )}
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <Link to={`/documents/${doc.id}`} className="min-w-0 flex-1">
              <p className="truncate font-medium">{doc.title}</p>
              <p className="truncate text-sm text-gray-500">{doc.source_url}</p>
              <ListeningStatus
                finished={doc.finished}
                fraction={doc.fraction}
                secondsLeft={doc.seconds_left}
              />
            </Link>
            <button
              onClick={() => handleDelete(doc)}
              className="text-sm text-gray-500 hover:text-red-600"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
