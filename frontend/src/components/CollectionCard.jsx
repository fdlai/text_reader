import { Link } from "react-router-dom";
import { collectionPath } from "../paths";
import Cover, { hue } from "./Cover";

const BOOK = "h-32 w-24 text-3xl";

// Where each book of the stack sits, front first: each one further back is
// shifted up and to the right, a little smaller and darker. Hovering the
// card fans them out. (Whole class names, so Tailwind can find them.)
const PLACES = [
  "z-30 group-hover:-rotate-3",
  "z-20 translate-x-4 -translate-y-2.5 scale-95 brightness-85 group-hover:translate-x-8 group-hover:-translate-y-3",
  "z-10 translate-x-8 -translate-y-5 scale-90 brightness-70 group-hover:translate-x-16 group-hover:-translate-y-5 group-hover:rotate-3",
];

// A collection's newest articles drawn as a stack of books. Missing books
// (fewer than three articles) are blank, so it always looks like a stack,
// and an empty collection's front book shows its first letter.
function BookStack({ name, stack }) {
  const books = PLACES.map((place, depth) => {
    const doc = stack[depth];
    let book;
    if (doc) book = <Cover doc={doc} size={BOOK} />;
    else if (depth === 0)
      book = (
        <Cover doc={{ id: 0, has_cover: false, title: name }} size={BOOK} />
      );
    else
      book = (
        <div
          style={{ backgroundColor: `hsl(${hue(name)} 35% 55% / 0.2)` }}
          className={`${BOOK} rounded-md`}
        />
      );
    return (
      <div
        key={depth}
        className={`absolute bottom-0 left-0 origin-bottom-left rounded-md shadow-[0_6px_14px_rgb(0_0_0/0.28)] transition duration-300 ${place}`}
      >
        {book}
        {/* A darker strip down the left edge, like a book's spine. */}
        <span className="absolute inset-y-0 left-0 w-2 rounded-l-md bg-linear-to-r from-[rgb(0_0_0/0.3)] to-transparent" />
      </div>
    );
  });
  // Drawn back to front, so the front book ends up on top.
  return <div className="relative h-40 w-32">{books.reverse()}</div>;
}

// A collection on the home page. Collections are cards and articles are
// rows, so the two can't be mistaken for each other.
export default function CollectionCard({ collection }) {
  const { id, name, document_count, in_progress_count, stack } = collection;
  const unsorted = id === null;
  return (
    <Link
      to={collectionPath(id)}
      className={`group flex flex-1 flex-col rounded-xl border transition hover:shadow-lg ${unsorted ? "border-dashed border-gray-300" : "border-gray-200 hover:border-gray-300"}`}
    >
      <div
        className={`flex h-52 items-end justify-center rounded-t-xl pb-6 ${unsorted ? "" : "bg-gray-50"}`}
      >
        <BookStack name={name} stack={stack} />
      </div>
      <div className="p-4 pt-3">
        <p
          className={`line-clamp-2 font-medium ${unsorted ? "text-gray-600 italic" : ""}`}
        >
          {name}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {document_count} {document_count === 1 ? "article" : "articles"}
          {in_progress_count > 0 && ` · ${in_progress_count} in progress`}
        </p>
      </div>
    </Link>
  );
}
