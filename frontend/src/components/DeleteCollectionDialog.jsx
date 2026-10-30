import { useEffect, useRef, useState } from "react";

// Asks whether a collection's articles go with it. onDelete(deleteArticles)
// is awaited; if it throws, its message is shown and the popup stays open.
// Styled like the confirmation popup (see ConfirmProvider).
export default function DeleteCollectionDialog({
  name,
  count,
  onDelete,
  onClose,
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const keepRef = useRef(null);

  useEffect(() => {
    dialogRef.current.showModal();
    // The safe choice starts focused, so pressing Enter by habit keeps them.
    keepRef.current.focus();
  }, []);

  async function handleDelete(deleteArticles) {
    setDeleting(true);
    setError("");
    try {
      await onDelete(deleteArticles);
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  const articles = count === 1 ? "1 article" : `${count} articles`;

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
        <h2 className="text-lg font-semibold">Delete “{name}”?</h2>
        {count === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            This collection is empty.
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            It has {articles}. If you delete only the collection, they move to
            Unsorted. Deleting them too removes their audio for every voice and
            your listening positions, and can't be undone.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
          >
            Cancel
          </button>
          {/* With no articles there's nothing to choose, so it's one button. */}
          <button
            ref={keepRef}
            disabled={deleting}
            onClick={() => handleDelete(false)}
            className={
              count === 0
                ? "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-[#fff] hover:bg-red-700 disabled:opacity-50"
                : "rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            }
          >
            {count === 0 ? "Delete" : "Delete collection only"}
          </button>
          {count > 0 && (
            // Plain white text: the theme's "white" is dark in dark mode.
            <button
              disabled={deleting}
              onClick={() => handleDelete(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-[#fff] hover:bg-red-700 disabled:opacity-50"
            >
              Delete collection and {articles}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
