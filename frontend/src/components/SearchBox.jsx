import { useEffect, useRef, useState } from "react";

// How long typing has to pause before searching, in milliseconds, so each
// key pressed doesn't send a request.
const WAIT = 300;

// A search box for a list. value is the search in use (e.g. from the
// address); onSearch(text) is called once typing pauses, and
// onTextChange(text), if given, on every change. wide fills the width
// available. Anything else (e.g. autoFocus, onKeyDown) goes to the <input>.
export default function SearchBox({
  value,
  onSearch,
  onTextChange,
  placeholder,
  wide = false,
  ...inputProps
}) {
  const [text, setText] = useState(value);
  // The last search sent, to tell it apart from a change made elsewhere.
  const sentRef = useRef(value);

  // The search changed some other way (e.g. with the Back button): show it.
  useEffect(() => {
    if (value !== sentRef.current) {
      sentRef.current = value;
      setText(value);
      onTextChange?.(value);
    }
  }, [value, onTextChange]);

  useEffect(() => {
    const search = text.trim();
    if (search === sentRef.current) return;
    const timer = setTimeout(() => {
      sentRef.current = search;
      onSearch(search);
    }, WAIT);
    return () => clearTimeout(timer);
  }, [text, onSearch]);

  return (
    <input
      type="search"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onTextChange?.(e.target.value);
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`w-full min-w-0 rounded border border-gray-300 px-3 py-1.5 text-sm ${
        wide ? "" : "max-w-xs"
      }`}
      {...inputProps}
    />
  );
}
