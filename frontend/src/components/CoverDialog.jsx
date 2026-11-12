import { useEffect, useRef, useState } from "react";
import { setDocumentCover } from "../api";

// A popup for changing an article's cover to an image from the web, or
// removing it. onDone(hasCover) runs once it's saved.
// Styled like the confirmation popup (see ConfirmProvider).
export default function CoverDialog({ doc, onDone, onClose }) {
  const [url, setUrl] = useState("");
  const [wholeCollection, setWholeCollection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const collection = doc.collection_name ?? "Unsorted";

  useEffect(() => {
    dialogRef.current.showModal();
  }, []);

  // imageUrl null removes the cover.
  async function save(imageUrl) {
    setSaving(true);
    setError("");
    try {
      await setDocumentCover(doc.id, imageUrl, wholeCollection);
      onDone(imageUrl !== null);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      // Escape: close through onClose rather than letting the browser do it.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-0 text-black shadow-2xl backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(url.trim());
        }}
        className="p-6"
      >
        <h2 className="text-lg font-semibold">Change cover</h2>
        <label className="mt-4 block text-sm text-gray-600">
          Image address
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/cover.jpg"
            required
            autoFocus
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base text-black"
          />
        </label>
        <p className="mt-1.5 text-sm text-gray-500">
          Right-click an image on a web page and choose "Copy image address".
          It's downloaded and saved, so it keeps working if the page changes.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={wholeCollection}
            onChange={(e) => setWholeCollection(e.target.checked)}
            className="size-4"
          />
          Apply to every article in “{collection}”
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex items-center gap-3">
          {doc.has_cover && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={saving}
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              Remove cover
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !url.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
