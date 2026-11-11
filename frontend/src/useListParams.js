import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// A list's page number and search, kept in the address (e.g. ?page=3&q=sword)
// rather than in state, so the Back button returns to the same page with
// the same search. Page 1 and an empty search are left out of the address.
export function useListParams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const q = params.get("q") ?? "";

  // replace: true changes the address without adding a step to go Back to,
  // e.g. when correcting a page number past the end.
  const setPage = useCallback(
    (n, replace = false) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (n > 1) next.set("page", n);
          else next.delete("page");
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  // A new search starts at page 1. It replaces the address, so Back doesn't
  // step through every search typed.
  const setQuery = useCallback(
    (text) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("page");
          if (text) next.set("q", text);
          else next.delete("q");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { page, q, setPage, setQuery };
}
