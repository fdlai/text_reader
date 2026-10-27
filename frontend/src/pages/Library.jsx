import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createDocument, deleteDocument, listDocuments } from "../api";

export default function Library() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listDocuments()
      .then(setDocuments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError("");
    try {
      const doc = await createDocument(url.trim());
      setDocuments((docs) => [doc, ...docs]);
      setUrl("");
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDocument(id);
      setDocuments((docs) => docs.filter((d) => d.id !== id));
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
            </Link>
            <button
              onClick={() => handleDelete(doc.id)}
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
