import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createDocument,
  deleteCollection,
  deleteDocument,
  deleteDocuments,
  getCollection,
  listDocuments,
  moveDocuments,
  renameCollection,
} from "../api";
import Cover from "../components/Cover";
import DeleteCollectionDialog from "../components/DeleteCollectionDialog";
import ListeningStatus from "../components/ListeningStatus";
import MoveDialog from "../components/MoveDialog";
import NameDialog from "../components/NameDialog";
import { useConfirm } from "../context/confirm";
import { usePlayer } from "../context/PlayerContext";

// One collection's articles, where new ones are added. "unsorted" in the
// address shows the articles in no collection, which can't be added to.
export default function Collection() {
  const { id } = useParams();
  const collectionId = id === "unsorted" ? null : Number(id);
  const [name, setName] = useState(collectionId === null ? "Unsorted" : "");
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  // Set when the pasted page is already in the Library: the copy's id.
  const [existingId, setExistingId] = useState(null);
  // The open popup: "rename", "delete" or null.
  const [dialog, setDialog] = useState(null);
  // In Select mode, the ids of the ticked articles; null otherwise.
  const [selected, setSelected] = useState(null);
  // The ids of the articles the Move popup is open for, or null.
  const [moving, setMoving] = useState(null);
  const navigate = useNavigate();
  const player = usePlayer();
  const confirm = useConfirm();
  const { saveNow } = player;

  // The position of whatever is playing is saved first, so its progress
  // here is up to date.
  useEffect(() => {
    Promise.all([
      collectionId === null ? null : getCollection(collectionId),
      saveNow().then(() => listDocuments(collectionId)),
    ])
      .then(([collection, docs]) => {
        if (collection) setName(collection.name);
        setDocuments(docs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [collectionId, saveNow]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError("");
    setExistingId(null);
    try {
      await createDocument(url.trim(), collectionId);
      // Reloaded rather than added, since the list includes each one's length.
      setDocuments(await listDocuments(collectionId));
      setUrl("");
    } catch (err) {
      setError(err.message);
      setExistingId(err.detail?.document_id ?? null);
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(newName) {
    setName((await renameCollection(collectionId, newName)).name);
    setDialog(null);
  }

  async function handleDeleteCollection(deleteArticles) {
    // As when deleting one article: stop it if it's about to disappear.
    if (
      deleteArticles &&
      documents.some((d) => d.id === player.session?.documentId)
    )
      player.close(false);
    await deleteCollection(collectionId, deleteArticles);
    navigate("/");
  }

  async function handleMove(target) {
    await moveDocuments(moving, target.id);
    setDocuments((docs) => docs.filter((d) => !moving.includes(d.id)));
    setMoving(null);
    setSelected(null);
  }

  async function handleDeleteSelected() {
    const n = selected.length;
    const articles = n === 1 ? "1 article" : `${n} articles`;
    const confirmed = await confirm({
      title: `Delete ${articles}?`,
      message: `${n === 1 ? "It" : "They"} will be removed, along with ${n === 1 ? "its" : "their"} audio for every voice and listening ${n === 1 ? "position" : "positions"}. This can't be undone.`,
      confirmLabel: `Delete ${articles}`,
    });
    if (!confirmed) return;
    setError("");
    try {
      // As when deleting one article: stop it if it's about to disappear.
      if (selected.includes(player.session?.documentId)) player.close(false);
      await deleteDocuments(selected);
      setDocuments((docs) => docs.filter((d) => !selected.includes(d.id)));
      setSelected(null);
    } catch (err) {
      setError(err.message);
    }
  }

  // Escape leaves Select mode, unless a popup is open (Escape closes that).
  const selecting = selected !== null;
  useEffect(() => {
    if (!selecting) return;
    function handleKey(e) {
      if (e.key === "Escape" && !e.target.closest("dialog")) setSelected(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selecting]);

  function toggleSelected(docId) {
    setSelected((ids) =>
      ids.includes(docId) ? ids.filter((i) => i !== docId) : [...ids, docId],
    );
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
      <Link to="/" className="text-sm text-gray-500 hover:underline">
        ← Library
      </Link>
      <div className="mt-1 flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 text-3xl font-semibold break-words">{name}</h1>
        {/* Unsorted isn't a real collection, so it can't be changed. */}
        {collectionId !== null && name && (
          <div className="flex shrink-0 gap-4 text-sm text-gray-500">
            <button
              onClick={() => setDialog("rename")}
              className="hover:text-black"
            >
              Rename
            </button>
            <button
              onClick={() => setDialog("delete")}
              className="hover:text-red-600"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {collectionId === null ? (
        <p className="mt-2 text-sm text-gray-500">
          Articles that aren't in any collection.
        </p>
      ) : (
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
      )}

      {error && (
        <p className="mt-3 text-red-600">
          {error}{" "}
          {existingId && (
            <Link to={`/documents/${existingId}`} className="underline">
              Open it
            </Link>
          )}
        </p>
      )}

      {/* Select mode: tick several articles to move them together. */}
      {documents.length > 0 && (
        <div className="mt-6 flex min-h-9 flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
          {selected === null ? (
            <button
              onClick={() => setSelected([])}
              className="text-gray-500 hover:text-black"
            >
              Select
            </button>
          ) : (
            <>
              <span className="mr-auto text-gray-600">
                {selected.length} selected
              </span>
              <button
                onClick={() =>
                  setSelected(
                    selected.length === documents.length
                      ? []
                      : documents.map((d) => d.id),
                  )
                }
                className="text-gray-500 hover:text-black"
              >
                {selected.length === documents.length
                  ? "Select none"
                  : "Select all"}
              </button>
              <button
                onClick={() => setSelected(null)}
                title="Cancel (Esc)"
                className="text-gray-500 hover:text-black"
              >
                Cancel
              </button>
              {/* Plain white text on hover: the theme's "white" is dark in
                  dark mode. */}
              <button
                disabled={selected.length === 0}
                onClick={handleDeleteSelected}
                className="rounded border border-red-600 px-3 py-1.5 text-red-600 hover:bg-red-600 hover:text-[#fff] disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-red-600"
              >
                Delete
              </button>
              <button
                disabled={selected.length === 0}
                onClick={() => setMoving(selected)}
                className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-50"
              >
                Move to…
              </button>
            </>
          )}
        </div>
      )}

      <ul className="mt-2 divide-y divide-gray-200">
        {loading && <li className="py-3 text-gray-500">Loading...</li>}
        {!loading && !error && documents.length === 0 && (
          <li className="py-3 text-gray-500">
            No articles yet.
            {collectionId !== null && " Paste a web address above to add one."}
          </li>
        )}
        {documents.map((doc) => {
          const details = (
            <>
              <Cover doc={doc} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="truncate text-sm text-gray-500">
                  {doc.source_url}
                </p>
                <ListeningStatus
                  finished={doc.finished}
                  fraction={doc.fraction}
                  secondsLeft={doc.seconds_left}
                />
              </div>
            </>
          );
          return (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              {selected !== null ? (
                // In Select mode a click anywhere on the row ticks it.
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
                  <input
                    type="checkbox"
                    checked={selected.includes(doc.id)}
                    onChange={() => toggleSelected(doc.id)}
                    className="size-4 shrink-0"
                  />
                  {details}
                </label>
              ) : (
                <>
                  <Link
                    to={`/documents/${doc.id}`}
                    className="flex min-w-0 flex-1 items-center gap-4"
                  >
                    {details}
                  </Link>
                  <div className="flex shrink-0 gap-4 text-sm text-gray-500">
                    <button
                      onClick={() => setMoving([doc.id])}
                      className="hover:text-black"
                    >
                      Move
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {moving && (
        <MoveDialog
          count={moving.length}
          currentId={collectionId}
          onMove={handleMove}
          onClose={() => setMoving(null)}
        />
      )}

      {dialog === "rename" && (
        <NameDialog
          title="Rename collection"
          label="Name"
          initialName={name}
          saveLabel="Rename"
          onSave={handleRename}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <DeleteCollectionDialog
          name={name}
          count={documents.length}
          onDelete={handleDeleteCollection}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
