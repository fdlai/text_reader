import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createCollection, listCollections } from "../api";
import SearchBox from "./SearchBox";
import { useModal } from "../useModal";

// How many collections are listed at first, and how many more "Show more"
// adds. Beyond that, typing narrows the list down.
const PAGE_SIZE = 8;

// Asks which collection to move articles to, or makes a new one for them,
// with a search box: before typing it lists the collections listened to
// most recently, the likeliest places; while typing, the best matches, then
// "+ Create" for a name that doesn't exist yet. ↑/↓ choose a row and Enter
// picks it.
// currentId and currentName: the collection the articles are in (none for
// Unsorted). onMove(collection), with the collection's id and name, is
// awaited; if it throws, its message is shown and the popup stays open.
// Styled like the confirmation popup (see ConfirmProvider).
export default function MoveDialog({
  count,
  currentId,
  currentName,
  onMove,
  onClose,
}) {
  // What's typed, right away, and what's searched for, once typing pauses.
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  // The collections found: { q, items, total }, or null until the first
  // load. The one they're in isn't offered, nor Unsorted: it's where
  // articles end up, not somewhere to put them.
  const [found, setFound] = useState(null);
  // The highlighted row's index, moved with the arrow keys or the mouse.
  const [active, setActive] = useState(0);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  // The search box is the first thing in it, so it gets the focus.
  useModal(dialogRef);

  useEffect(() => {
    let current = true;
    listCollections({
      page,
      pageSize: PAGE_SIZE,
      q,
      sort: q ? "name" : "listened",
      exclude: currentId,
      withUnsorted: false,
    })
      .then(({ items, total }) => {
        if (!current) return;
        // "Show more" adds to the list; a new search replaces it.
        setFound((f) => ({
          q,
          total,
          items: page === 1 ? items : [...f.items, ...items],
        }));
        if (page === 1) setActive(0);
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [q, page, currentId]);

  const search = useCallback((s) => {
    setQ(s);
    setPage(1);
  }, []);

  // An error is about what was tried, so it goes once the text changes.
  const type = useCallback((t) => {
    setText(t);
    setError("");
  }, []);

  const name = text.trim();
  const sameName = (other) => other.toLowerCase() === name.toLowerCase();
  // The search waits for typing to pause, so for a moment the list can
  // still be for what was typed before.
  const upToDate = found?.q === name;
  // The collection they're in isn't listed, but its name is taken too.
  const isCurrent = Boolean(name && currentName && sameName(currentName));
  const exists = isCurrent || found?.items.some((c) => sameName(c.name));
  const rows = [
    ...(found?.items.map((collection) => ({ collection })) ?? []),
    ...(name && upToDate && !exists ? [{ create: name }] : []),
  ];
  const activeIndex = Math.min(active, rows.length - 1);

  // Keep the highlighted row in view when the arrow keys move past the edge.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  async function choose(row) {
    setMoving(true);
    setError("");
    try {
      await onMove(
        row.create ? await createCollection(row.create) : row.collection,
      );
    } catch (err) {
      setError(err.message);
      setMoving(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Otherwise the cursor jumps to the start or end of the text.
      e.preventDefault();
      if (rows.length === 0) return;
      // Going past the last row comes back to the first, and the other way.
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Not while the list is for an earlier search, or Enter could pick a
      // row the user hasn't seen yet.
      if (upToDate && rows[activeIndex] && !moving) choose(rows[activeIndex]);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      // Pinned near the top rather than centered, so the search box stays
      // put while the list below it grows and shrinks.
      className="mx-auto mt-[8vh] mb-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-0 text-black shadow-2xl backdrop:bg-[rgb(0_0_0/0.5)] sm:mt-[15vh]"
    >
      <div className="p-6">
        {/* Closing is up here too (as well as Esc and clicking outside),
            so nothing to click moves when the list changes. */}
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">
            Move {count === 1 ? "article" : `${count} articles`} to…
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black"
          >
            ✕
          </button>
        </div>

        <div className="mt-4">
          <SearchBox
            value={q}
            onSearch={search}
            onTextChange={type}
            placeholder="Search or name a new collection"
            wide
            maxLength={100}
            disabled={moving}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              rows.length > 0 ? `${listId}-${activeIndex}` : undefined
            }
          />
        </div>

        {found === null && !error && (
          <p className="mt-3 text-sm text-gray-500">Loading...</p>
        )}
        {found && rows.length === 0 && !name && (
          <p className="mt-3 text-sm text-gray-500">
            No other collections yet. Type a name to make one.
          </p>
        )}
        {isCurrent && upToDate && (
          <p className="mt-3 text-sm text-gray-500">
            {count === 1 ? "The article is" : "These articles are"} already in “
            {currentName}”.
          </p>
        )}
        {rows.length > 0 && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Collections"
            className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-gray-200 py-1"
          >
            {rows.map((row, i) => (
              <li
                key={row.create ? "create" : row.collection.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // Keeps the focus in the search box, so the keys still work.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => !moving && choose(row)}
                className={`cursor-pointer truncate px-3 py-2 ${
                  i === activeIndex ? "bg-gray-100" : ""
                } ${row.create && i > 0 ? "border-t border-gray-200" : ""} ${
                  moving ? "opacity-50" : ""
                }`}
              >
                {row.create ? (
                  <span className="text-gray-700">+ Create “{row.create}”</span>
                ) : (
                  row.collection.name
                )}
              </li>
            ))}
          </ul>
        )}
        {found && found.items.length < found.total && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
            <span>
              {found.items.length} of {found.total} shown.{" "}
              {q ? "Keep typing to narrow it down." : "Type to find others."}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              className="shrink-0 underline hover:text-black"
            >
              Show more
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </dialog>
  );
}
