import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createTextDocument,
  getCollection,
  getDocumentText,
  updateDocumentText,
} from "../api";
import { useConfirm } from "../context/confirm";
import { usePlayer } from "../context/PlayerContext";
import { setEditNotice } from "../editNotice";
import { collectionPath } from "../paths";

// The most text one article can have (the server checks this too).
const MAX_CHARS = 500_000;
// Unsaved text is kept in the browser while typing, so a refresh or a
// closed tab doesn't lose it. Drafts left this long are removed.
const DRAFT_DAYS = 7;
const DRAFT_PREFIX = "draft:";

// localStorage can be unavailable (e.g. blocked by the browser), and can be
// full. Drafts are only a safety net, so any problem just skips them.
function readDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeDraft(key, draft) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // no draft then
  }
}

// The text with exactly one blank line between paragraphs (each line is a
// paragraph, as on the server).
function spaceParagraphs(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

// Forgotten drafts would otherwise stay in the browser for good.
function removeOldDrafts() {
  try {
    const oldest = Date.now() - DRAFT_DAYS * 24 * 60 * 60 * 1000;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DRAFT_PREFIX) && !(readDraft(key)?.savedAt > oldest)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // nothing to tidy
  }
}

// Typing or pasting in a new article (at /collections/:id/new), or with
// editing, changing an article's title and text (at /documents/:id/edit).
export default function TextEditor({ editing = false }) {
  const { id } = useParams();
  // The collection a new article goes in, or the article being edited.
  const collectionId = editing || id === "unsorted" ? null : Number(id);
  const documentId = editing ? Number(id) : null;
  const draftKey = `${DRAFT_PREFIX}${editing ? "edit" : "new"}:${id}`;
  const [name, setName] = useState(
    !editing && collectionId === null ? "Unsorted" : "",
  );
  // When editing, the saved title and text, once loaded.
  const [original, setOriginal] = useState(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  // A draft found on opening, until it's restored or discarded. Typing
  // meanwhile doesn't replace it.
  const [draft, setDraft] = useState(() => {
    removeOldDrafts();
    const found = readDraft(draftKey);
    return found?.title || found?.text ? found : null;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Set once saved or discarded, when the draft is no longer wanted.
  const finished = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const player = usePlayer();
  const loading = editing && !original;
  const changed = editing
    ? Boolean(original) && (title !== original.title || text !== original.text)
    : Boolean(title.trim() || text.trim());
  const tooLong = text.length > MAX_CHARS;

  useEffect(() => {
    if (editing) {
      getDocumentText(documentId)
        .then((loaded) => {
          // A blank line between paragraphs, so they're easy to tell apart
          // while editing. Blank lines are ignored when the text is split
          // into sections, so this changes nothing about the audio.
          const saved = {
            title: loaded.title,
            text: spaceParagraphs(loaded.text),
          };
          setOriginal(saved);
          setTitle(saved.title);
          setText(saved.text);
          setName(saved.title);
          // A draft the same as what's saved has nothing to restore.
          setDraft((d) =>
            d?.title === saved.title && d?.text === saved.text ? null : d,
          );
        })
        .catch((e) => setError(e.message));
    } else if (collectionId !== null) {
      getCollection(collectionId)
        .then((c) => setName(c.name))
        .catch((e) => setError(e.message));
    }
  }, [editing, documentId, collectionId]);

  // Saved shortly after typing stops rather than on every key, since a long
  // text takes a moment to store.
  useEffect(() => {
    if (draft || loading) return;
    const timer = setTimeout(() => {
      // Not after saving or discarding, which removed the draft.
      if (finished.current) return;
      writeDraft(
        draftKey,
        changed ? { title, text, savedAt: Date.now() } : null,
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, loading, draftKey, title, text, changed]);

  // The browser asks before a refresh or closing the tab loses the text.
  // (The draft would keep it too, but this saves restoring it.)
  useEffect(() => {
    if (!changed) return;
    function handleBeforeUnload(e) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [changed]);

  function restoreDraft() {
    setTitle(draft.title ?? "");
    setText(draft.text ?? "");
    setDraft(null);
  }

  // Back to where this was opened from: the collection, or the article
  // being edited. Opened from the article, it's a step back in the
  // browser's history, so Back there doesn't return here.
  function leave() {
    if (editing && location.state?.fromReader) navigate(-1);
    else if (editing) navigate(`/documents/${documentId}`, { replace: true });
    else navigate(collectionPath(collectionId));
  }

  async function handleCancel() {
    if (changed) {
      const confirmed = await confirm({
        title: editing ? "Discard your changes?" : "Discard this text?",
        message: editing
          ? "The article stays as it was."
          : "What you've typed won't be saved.",
        confirmLabel: "Discard",
      });
      if (!confirmed) return;
    }
    finished.current = true;
    writeDraft(draftKey, null);
    leave();
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) {
        // Its audio is about to change, so the player lets go of it. The
        // position is saved first, and the server moves it if its section
        // changed.
        const textChanged = text.trim() !== original.text.trim();
        if (textChanged && player.session?.documentId === documentId) {
          await player.saveNow();
          player.close(false);
        }
        const result = await updateDocumentText(documentId, title, text);
        finished.current = true;
        writeDraft(draftKey, null);
        if (textChanged) setEditNotice(documentId, result);
        leave();
      } else {
        const doc = await createTextDocument(title, text, collectionId);
        finished.current = true;
        writeDraft(draftKey, null);
        // Replaced, so Back from the article goes to the collection rather
        // than an empty editor.
        navigate(`/documents/${doc.id}`, { replace: true });
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) {
    return error ? (
      <p className="text-red-600">{error}</p>
    ) : (
      <p className="text-gray-500">Loading...</p>
    );
  }

  return (
    <form onSubmit={handleSave}>
      <Link
        to={editing ? `/documents/${documentId}` : collectionPath(collectionId)}
        className="text-sm text-gray-500 hover:underline"
      >
        ← {name || "Back"}
      </Link>
      <h1 className="mt-1 text-3xl font-semibold">
        {editing ? "Edit article" : "New article"}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {editing
          ? "Sections you don't change keep their audio; only changed ones are made again."
          : "Type or paste any text to listen to, such as an email, a document or something you've written."}
      </p>

      {draft && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="flex-1">
            You have unsaved {editing ? "changes" : "text"} from{" "}
            {new Date(draft.savedAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .
          </p>
          <button
            type="button"
            onClick={restoreDraft}
            className="rounded bg-black px-3 py-1.5 text-white"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-gray-500 hover:text-black"
          >
            Discard
          </button>
        </div>
      )}

      <label
        htmlFor="text-title"
        className="mt-6 block text-sm font-semibold text-gray-600"
      >
        Title <span className="font-normal text-gray-500">(optional)</span>
      </label>
      <input
        id="text-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={500}
        placeholder="Left empty, the first words are used"
        className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2"
      />

      <label
        htmlFor="text-body"
        className="mt-5 block text-sm font-semibold text-gray-600"
      >
        Text
      </label>
      <textarea
        id="text-body"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus={!draft && !editing}
        className="mt-2 block min-h-96 w-full resize-y rounded border border-gray-300 bg-white px-3 py-2 leading-relaxed"
      />
      <div className="mt-1.5 flex justify-between gap-4 text-sm text-gray-500">
        <p>Each new line starts a new paragraph.</p>
        <p className={`tabular-nums ${tooLong ? "text-red-600" : ""}`}>
          {text.length.toLocaleString()}
          {tooLong && ` of ${MAX_CHARS.toLocaleString()}`} characters
        </p>
      </div>
      {tooLong && (
        <p className="mt-1 text-sm text-red-600">
          That's too long for one article. Try splitting it into several.
        </p>
      )}

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <div className="mt-6 flex gap-2">
        <button
          type="submit"
          disabled={!text.trim() || tooLong || saving}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded px-4 py-2 text-gray-600 hover:bg-black/5 hover:text-black"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
