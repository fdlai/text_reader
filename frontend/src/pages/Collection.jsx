import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createDocument,
  deleteCollection,
  deleteDocument,
  deleteDocuments,
  getCollection,
  getDocument,
  listDocuments,
  moveDocuments,
  renameCollection,
} from "../api";
import Cover from "../components/Cover";
import DeleteCollectionDialog from "../components/DeleteCollectionDialog";
import ListeningStatus from "../components/ListeningStatus";
import MoveDialog from "../components/MoveDialog";
import NameDialog from "../components/NameDialog";
import Pagination from "../components/Pagination";
import SearchBox from "../components/SearchBox";
import SortSelect from "../components/SortSelect";
import { useConfirm } from "../context/confirm";
import { usePlayer } from "../context/PlayerContext";
import { useListParams } from "../useListParams";

const PAGE_SIZE = 50;
// The first of each is the default.
const SORTS = {
  newest: "Newest added",
  oldest: "Oldest added",
  listened: "Recently listened",
};
const PROGRESS = {
  all: "All",
  "not-started": "Not started",
  "in-progress": "In progress",
  finished: "Finished",
};
// What the list says when nothing has that progress.
const EMPTY = {
  "not-started": "Every article here has been started.",
  "in-progress": "Nothing in progress.",
  finished: "No finished articles yet.",
};

// One collection's articles, where new ones are added.
// "unsorted" in the address shows the articles in no collection, which
// can't be added to.
export default function Collection() {
  const { id } = useParams();
  const collectionId = id === "unsorted" ? null : Number(id);
  const [name, setName] = useState(collectionId === null ? "Unsorted" : "");
  // How many articles the collection has in all, whatever the search.
  const [documentCount, setDocumentCount] = useState(0);
  // This page of articles, and how many there are on every page.
  const [documents, setDocuments] = useState([]);
  const [total, setTotal] = useState(0);
  // Whether to show the search box: once there's anything to search, and
  // from then on. Hiding it while a search with no results is cleared would
  // take away the focus mid-typing.
  const [searchable, setSearchable] = useState(false);
  // Changed to load the page again, e.g. after deleting from it.
  const [reloadKey, setReloadKey] = useState(0);
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
  const { page, q, setPage, setQuery, option, setOption } = useListParams();
  const sort = option("sort", Object.keys(SORTS));
  const progress = option("progress", Object.keys(PROGRESS));
  // Whether only some of the articles are shown.
  const filtered = Boolean(q) || progress !== "all";
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const reload = () => setReloadKey((k) => k + 1);

  // The position of whatever is playing is saved first, so its progress
  // here is up to date.
  useEffect(() => {
    // An older request finishing late is ignored, so a quick change of page
    // or search can't show the wrong results.
    let current = true;
    Promise.all([
      collectionId === null ? null : getCollection(collectionId),
      saveNow().then(() =>
        listDocuments(collectionId, {
          page,
          pageSize: PAGE_SIZE,
          q,
          sort,
          progress,
        }),
      ),
    ])
      .then(([collection, { items, total }]) => {
        if (!current) return;
        // Past the last page (e.g. after deleting the only article on it):
        // go to the last one.
        if (items.length === 0 && total > 0) {
          setPage(Math.ceil(total / PAGE_SIZE), true);
          return;
        }
        if (collection) {
          setName(collection.name);
          setDocumentCount(collection.document_count);
        }
        setDocuments(items);
        setTotal(total);
        if (total > 0 || filtered) setSearchable(true);
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [
    collectionId,
    page,
    q,
    sort,
    progress,
    filtered,
    reloadKey,
    saveNow,
    setPage,
  ]);

  function changePage(n) {
    setPage(n);
    window.scrollTo(0, 0);
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError("");
    setExistingId(null);
    try {
      await createDocument(url.trim(), collectionId);
      // Shown first in the usual view (newest first, nothing left out), so
      // that view is shown. Reloaded rather than added, since the list
      // includes each one's length.
      if (page === 1 && !filtered && sort === "newest") reload();
      else navigate({ search: "" });
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
    // As when deleting one article: stop it if it's about to disappear. It
    // may be on another page, so its collection is looked up.
    if (deleteArticles && player.session) {
      const playing = await getDocument(player.session.documentId).catch(
        () => null,
      );
      if (playing?.collection_id === collectionId) player.close(false);
    }
    await deleteCollection(collectionId, deleteArticles);
    navigate("/");
  }

  async function handleMove(target) {
    await moveDocuments(moving, target.id);
    setMoving(null);
    setSelected(null);
    // Loaded again rather than removed here, so the next page's first
    // articles move up into the gap.
    reload();
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
      setSelected(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  // Whether every article on this page is ticked.
  const pageIds = documents.map((d) => d.id);
  const pageSelected = pageIds.every((i) => selected?.includes(i));

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
      reload();
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

      {searchable && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SearchBox
              value={q}
              onSearch={setQuery}
              placeholder="Search articles"
            />
            <span className="mr-auto text-sm text-gray-500 tabular-nums">
              {filtered
                ? `${total} found`
                : `${total} ${total === 1 ? "article" : "articles"}`}
            </span>
            <SortSelect
              value={sort}
              options={SORTS}
              onChange={(value) => setOption("sort", value, "newest")}
            />
          </div>
          <div
            role="group"
            aria-label="Show"
            className="mt-3 flex flex-wrap gap-1.5 text-sm"
          >
            {Object.entries(PROGRESS).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setOption("progress", value, "all")}
                aria-pressed={progress === value}
                className={`rounded-full border px-3 py-1 ${
                  progress === value
                    ? "border-black bg-black text-white"
                    : "border-gray-300 text-gray-600 hover:border-gray-400 hover:text-black"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Select mode: tick several articles to move them together. Ticks
          are kept when changing page. */}
      {documents.length > 0 && (
        <div className="mt-2 flex min-h-9 flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
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
                    pageSelected
                      ? selected.filter((i) => !pageIds.includes(i))
                      : [...new Set([...selected, ...pageIds])],
                  )
                }
                className="text-gray-500 hover:text-black"
              >
                {pageSelected ? "Select none" : "Select all"}
                {pageCount > 1 && " on this page"}
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
            {q ? (
              `No articles match “${q}”.`
            ) : progress !== "all" ? (
              EMPTY[progress]
            ) : (
              <>
                No articles yet.
                {collectionId !== null &&
                  " Paste a web address above to add one."}
              </>
            )}
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
              className="flex items-center justify-between gap-4"
            >
              {selected !== null ? (
                // In Select mode a click anywhere on the row ticks it.
                <label className="-ml-3 flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-row-hover">
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
                    className="-ml-3 flex min-w-0 flex-1 items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-row-hover"
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
      <Pagination page={page} pageCount={pageCount} onChange={changePage} />

      {moving && (
        <MoveDialog
          count={moving.length}
          currentId={collectionId}
          currentName={collectionId === null ? null : name}
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
          count={documentCount}
          onDelete={handleDeleteCollection}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
