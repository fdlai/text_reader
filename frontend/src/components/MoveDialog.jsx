import { useEffect, useRef, useState } from "react";
import { createCollection, listCollections } from "../api";

// Asks which collection to move articles to, or makes a new one for them.
// onMove(collection), with the collection's id and name, is awaited; if it throws, its message is shown and
// the popup stays open. Styled like the confirmation popup (see
// ConfirmProvider).
export default function MoveDialog({ count, currentId, onMove, onClose }) {
  // Every collection but the one they're in. Unsorted isn't offered: it's
  // where articles end up, not somewhere to put them.
  const [collections, setCollections] = useState(null);
  const [newName, setNewName] = useState("");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current.showModal();
    listCollections()
      .then((all) =>
        setCollections(all.filter((c) => c.id !== null && c.id !== currentId)),
      )
      .catch((e) => setError(e.message));
  }, [currentId]);

  async function move(getCollection) {
    setMoving(true);
    setError("");
    try {
      await onMove(await getCollection());
    } catch (err) {
      setError(err.message);
      setMoving(false);
    }
  }

  function handleCreate(e) {
    e.preventDefault();
    move(() => createCollection(newName.trim()));
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-0 text-black shadow-2xl backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold">
          Move {count === 1 ? "article" : `${count} articles`} to…
        </h2>

        {collections === null && !error && (
          <p className="mt-4 text-sm text-gray-500">Loading...</p>
        )}
        {collections?.length > 0 && (
          <ul className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-gray-200">
            {collections.map((c) => (
              <li key={c.id}>
                <button
                  disabled={moving}
                  onClick={() => move(() => c)}
                  className="block w-full truncate px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-50"
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreate} className="mt-4">
          <label className="block text-sm text-gray-600">
            {collections?.length === 0
              ? "New collection"
              : "Or a new collection"}
            <div className="mt-1 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                placeholder="Name"
                className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-base text-black"
              />
              <button
                type="submit"
                disabled={moving || !newName.trim()}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Create and move
              </button>
            </div>
          </label>
        </form>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
