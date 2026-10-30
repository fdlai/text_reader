import { useEffect, useRef, useState } from "react";

// A popup asking for a name, e.g. for a new collection. onSave(name) is
// awaited; if it throws, its message is shown and the popup stays open.
// Styled like the confirmation popup (see ConfirmProvider).
export default function NameDialog({
  title,
  label,
  initialName = "",
  saveLabel,
  onSave,
  onClose,
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current.showModal();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
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
      <form onSubmit={handleSubmit} className="p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <label className="mt-4 block text-sm text-gray-600">
          {label}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            autoFocus
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base text-black"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
