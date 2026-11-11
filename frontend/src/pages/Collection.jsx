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
import MoreMenu from "../components/MoreMenu";
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
  // How many match the search with each progress, for the tabs: { all:
  // 56, "not-started": 16, ... }. null until loaded.
  const [counts, setCounts] = useState(null);
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
      .then(([collection, { items, total, counts }]) => {
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
        setCounts(counts);
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
      <div className="mt-1 flex items-start justify-between gap-4">
        <h1 className="min-w-0 text-3xl font-semibold break-words">{name}</h1>
        {/* Unsorted isn't a real collection, so it can't be changed.
            Renaming and deleting are rare, so they're kept in a menu. */}
        {collectionId !== null && name && (
          <MoreMenu
            items={[
              {
                label: "Rename collection",
                onClick: () => setDialog("rename"),
              },
              {
                label: "Delete collection",
                onClick: () => setDialog("delete"),
                danger: true,
              },
            ]}
            buttonClass="size-9 shrink-0 rounded-full text-gray-500 hover:bg-black/5 hover:text-black"
          />
        )}
      </div>

      {collectionId === null ? (
        <p className="mt-2 text-sm text-gray-500">
          Articles that aren't in any collection.
        </p>
      ) : (
        // A box of its own, so adding isn't mistaken for searching.
        <form
          onSubmit={handleAdd}
          className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          <label
            htmlFor="add-url"
            className="text-sm font-semibold text-gray-600"
          >
            Add an article
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="add-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-2"
              required
            />
            <button
              type="submit"
              disabled={adding}
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add"}
            </button>
          </div>
          <p className="mt-1.5 text-sm text-gray-500">
            Paste the address of a web page, such as a chapter or a blog post.
            Its text is pulled out for you to listen to.
          </p>
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
          {/* Tabs over the list, each with how many it has (within the
              search), e.g. how many chapters are left to start. */}
          <div
            role="group"
            aria-label="Show"
            className="mt-8 flex flex-wrap gap-x-6 border-b border-gray-200"
          >
            {Object.entries(PROGRESS).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setOption("progress", value, "all")}
                aria-pressed={progress === value}
                className={`-mb-px border-b-2 py-2.5 ${
                  progress === value
                    ? "border-black text-black"
                    : "border-transparent text-gray-500 hover:text-black"
                }`}
              >
                {label}
                {counts && (
                  <span className="ml-1.5 text-xs text-gray-500 tabular-nums">
                    {counts[value]}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* In Select mode this row turns into the selection's actions,
              at the same height, so the list doesn't move. Ticks are kept
              when changing page. */}
          <div className="mt-3 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {selected === null ? (
              <>
                <SearchBox
                  value={q}
                  onSearch={setQuery}
                  placeholder="Search articles"
                />
                <div className="ml-auto flex items-center gap-4">
                  <SortSelect
                    value={sort}
                    options={SORTS}
                    onChange={(value) => setOption("sort", value, "newest")}
                  />
                  {documents.length > 0 && (
                    <button
                      onClick={() => setSelected([])}
                      className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="4" y="4" width="16" height="16" rx="3" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                      Select
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="text-gray-600 tabular-nums">
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
                  className="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-gray-500 hover:text-black"
                >
                  {pageSelected ? "Select none" : "Select all"}
                  {pageCount > 1 && " on this page"}
                </button>
                <div className="ml-auto flex items-center gap-4">
                  {/* Plain white text on hover: the theme's "white" is dark
                      in dark mode. */}
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
                  {/* Where Select was, so clicking the same spot again
                      leaves Select mode. */}
                  <button
                    onClick={() => setSelected(null)}
                    title="Cancel (Esc)"
                    className="flex items-center gap-1.5 text-gray-500 hover:text-black"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </>
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
                // In Select mode a click anywhere on the row ticks it. The
                // box is on the right, where Move and Delete were, so the
                // cover and title stay where they are.
                <label className="-mx-3 flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-row-hover">
                  {details}
                  <input
                    type="checkbox"
                    checked={selected.includes(doc.id)}
                    onChange={() => toggleSelected(doc.id)}
                    className="size-5 shrink-0"
                  />
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
