// Page links under a list: ‹ Previous 1 … 6 7 8 … 14 Next ›. Shows nothing
// when everything fits on one page.
export default function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;

  const arrowClass =
    "rounded px-3 py-2 text-gray-600 hover:bg-gray-100 hover:text-black disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <nav
      aria-label="Pages"
      className="mt-6 flex flex-wrap items-center justify-center gap-1 text-sm tabular-nums"
    >
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className={arrowClass}
      >
        ‹ Previous
      </button>
      {pageNumbers(page, pageCount).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} className="px-1 text-gray-500">
            …
          </span>
        ) : (
          <button
            key={n}
            onClick={() => onChange(n)}
            aria-current={n === page ? "page" : undefined}
            className={`min-w-9 rounded px-2 py-2 ${
              n === page
                ? "bg-black font-medium text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-black"
            }`}
          >
            {n}
          </button>
        ),
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === pageCount}
        className={arrowClass}
      >
        Next ›
      </button>
    </nav>
  );
}

// The first and last pages, and the current one with one on each side, in
// order, with null where pages are left out (shown as …). Leaving out just
// one page would save nothing, so that page is shown instead.
function pageNumbers(page, count) {
  const shown = [...new Set([1, page - 1, page, page + 1, count])]
    .filter((n) => n >= 1 && n <= count)
    .sort((a, b) => a - b);
  const result = [];
  shown.forEach((n, i) => {
    const gap = i > 0 ? n - shown[i - 1] : 1;
    if (gap === 2) result.push(n - 1);
    else if (gap > 2) result.push(null);
    result.push(n);
  });
  return result;
}
