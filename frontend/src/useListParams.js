import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// A list's page number, search and choices like the sort order, kept in the
// address (e.g. ?page=3&q=sword) rather than in state, so the Back button
// returns to the same page with the same search. Page 1, an empty search
// and default choices are left out of the address.
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

  // A choice such as the sort order (?sort=oldest). choices are the allowed
  // values, the first being the default, which is left out of the address.
  // Anything else in the address (e.g. mistyped) counts as the default.
  function option(name, choices) {
    const value = params.get(name);
    return choices.includes(value) ? value : choices[0];
  }

  // A new choice starts at page 1, and can be gone back from like a page.
  const setOption = useCallback(
    (name, value, defaultValue) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("page");
        if (value === defaultValue) next.delete(name);
        else next.set(name, value);
        return next;
      }),
    [setParams],
  );

  return { page, q, setPage, setQuery, option, setOption };
}
