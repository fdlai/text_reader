import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createCollection, listCollections, listRecentDocuments } from "../api";
import CollectionCard from "../components/CollectionCard";
import Cover from "../components/Cover";
import ListeningStatus from "../components/ListeningStatus";
import NameDialog from "../components/NameDialog";
import Pagination from "../components/Pagination";
import SearchBox from "../components/SearchBox";
import SortSelect from "../components/SortSelect";
import { usePlayer } from "../context/PlayerContext";
import { collectionPath } from "../paths";
import { useListParams } from "../useListParams";

// Fills whole rows of the grid, which has 2 or 3 columns.
const PAGE_SIZE = 24;
// The first is the default.
const SORTS = { listened: "Recently listened", name: "Name" };

// The Library's front page: what's being listened to, then the collections.
// Articles are added inside a collection.
export default function Home() {
  // This page of collections, and how many there are on every page.
  const [collections, setCollections] = useState([]);
  const [total, setTotal] = useState(0);
  // Whether to show the search box: once there's anything to search, and
  // from then on. Hiding it while a search with no results is cleared would
  // take away the focus mid-typing.
  const [searchable, setSearchable] = useState(false);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { saveNow } = usePlayer();
  const { page, q, setPage, setQuery, option, setOption } = useListParams();
  const sort = option("sort", Object.keys(SORTS));
  const pageCount = Math.ceil(total / PAGE_SIZE);

  // The position of whatever is playing is saved first, so it's at the top
  // of Continue listening with its progress up to date.
  useEffect(() => {
    saveNow()
      .then(listRecentDocuments)
      .then(setRecent)
      .catch((e) => setError(e.message));
  }, [saveNow]);

  useEffect(() => {
    // An older request finishing late is ignored, so a quick change of page
    // or search can't show the wrong results.
    let current = true;
    listCollections({ page, pageSize: PAGE_SIZE, q, sort })
      .then(({ items, total }) => {
        if (!current) return;
        // Past the last page (e.g. an old link): go to the last one.
        if (items.length === 0 && total > 0) {
          setPage(Math.ceil(total / PAGE_SIZE), true);
          return;
        }
        setCollections(items);
        setTotal(total);
        if (total > 0 || q) setSearchable(true);
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [page, q, sort, setPage]);

  function changePage(n) {
    setPage(n);
    window.scrollTo(0, 0);
  }

  // Opens the new collection straight away, ready to add articles to it.
  async function handleCreate(name) {
    const collection = await createCollection(name);
    navigate(collectionPath(collection.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Library</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-black px-4 py-2 text-white"
        >
          New collection
        </button>
      </div>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      {/* One click back into whatever was being listened to. */}
      {recent.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-gray-500">
            Continue listening
          </h2>
          <ul className="mt-2 divide-y divide-gray-200">
            {recent.map((doc) => (
              <li key={doc.id}>
                {/* The whole row opens it; a background on hover shows how
                    far the row reaches. Shifted left by its padding, so
                    the cover still lines up with the heading. */}
                <Link
                  to={`/documents/${doc.id}`}
                  className="-mx-3 flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-row-hover"
                >
                  <Cover doc={doc} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{doc.title}</p>
                    <ListeningStatus
                      finished={doc.finished}
                      fraction={doc.fraction}
                      secondsLeft={doc.seconds_left}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {searchable && (
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="mr-auto text-sm font-medium text-gray-500">
            Collections
          </h2>
          <SortSelect
            value={sort}
            options={SORTS}
            onChange={(value) => setOption("sort", value, "listened")}
          />
          <SearchBox
            value={q}
            onSearch={setQuery}
            placeholder="Search collections"
          />
        </div>
      )}

      {loading && <p className="mt-6 text-gray-500">Loading...</p>}
      {!loading && q && total === 0 && (
        <p className="mt-6 text-gray-500">No collections match “{q}”.</p>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {/* Until there's a collection of their own (Unsorted doesn't count),
            a card in the grid shows where to start. */}
        {!loading &&
          !error &&
          !q &&
          collections.every((c) => c.id === null) && (
            <li className="flex">
              <button
                onClick={() => setCreating(true)}
                className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 p-6 text-center text-gray-500 transition hover:border-gray-400 hover:text-black"
              >
                <span className="text-4xl leading-none">+</span>
                <span className="font-medium text-black">New collection</span>
                <span className="text-sm">
                  Articles live in collections, such as one per novel. Make one,
                  then open it to add articles by their web address.
                </span>
              </button>
            </li>
          )}
        {collections.map((c) => (
          <li key={c.id ?? "unsorted"} className="flex">
            <CollectionCard collection={c} />
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} onChange={changePage} />

      {creating && (
        <NameDialog
          title="New collection"
          label="Name"
          saveLabel="Create"
          onSave={handleCreate}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
