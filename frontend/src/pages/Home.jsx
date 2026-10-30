import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createCollection, listCollections, listRecentDocuments } from "../api";
import CollectionCard from "../components/CollectionCard";
import Cover from "../components/Cover";
import ListeningStatus from "../components/ListeningStatus";
import NameDialog from "../components/NameDialog";
import { usePlayer } from "../context/PlayerContext";
import { collectionPath } from "../paths";

// The Library's front page: what's being listened to, then the collections.
// Articles are added inside a collection.
export default function Home() {
  const [collections, setCollections] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { saveNow } = usePlayer();

  // The position of whatever is playing is saved first, so it's at the top
  // of Continue listening with its progress up to date.
  useEffect(() => {
    Promise.all([listCollections(), saveNow().then(listRecentDocuments)])
      .then(([collections, recent]) => {
        setCollections(collections);
        setRecent(recent);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [saveNow]);

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
                <Link
                  to={`/documents/${doc.id}`}
                  className="flex items-center gap-4 py-3"
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
          <h2 className="mt-8 text-sm font-medium text-gray-500">
            Collections
          </h2>
        </>
      )}

      {loading && <p className="mt-6 text-gray-500">Loading...</p>}
      <ul
        className={`${recent.length > 0 ? "mt-3" : "mt-6"} grid grid-cols-2 gap-4 sm:grid-cols-3`}
      >
        {/* Until there's a collection of their own (Unsorted doesn't count),
            a card in the grid shows where to start. */}
        {!loading && !error && collections.every((c) => c.id === null) && (
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
