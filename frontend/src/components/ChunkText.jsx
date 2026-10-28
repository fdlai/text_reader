import { Fragment, memo, useMemo } from "react";

// The backend sends each chunk already split into paragraphs of words.
// Numbering them in order across the whole chunk gives each word the same
// number as its entry in the chunk's word timings.
function numberWords(paragraphs) {
  let index = 0;
  return paragraphs.map((words) =>
    words.map((word) => ({ word, index: index++ })),
  );
}

// memo: only re-renders when its props change, so while one chunk is being
// read, the other chunks on the page are left alone.
// data-word holds each word's number, so a text selection can be traced back
// to a word (for "Play from here"). The space is kept outside the word's
// span, so a selection starting on a space doesn't count the previous word.
// data-current-word is set even with highlighting turned off, because
// following the reading position uses it to scroll.
export default memo(function ChunkText({ paragraphs, currentWord, highlight }) {
  const numbered = useMemo(() => numberWords(paragraphs), [paragraphs]);

  return numbered.map((words, i) => (
    <p key={i}>
      {words.map(({ word, index }) => (
        <Fragment key={index}>
          <span
            data-word={index}
            data-current-word={index === currentWord || undefined}
            className={
              highlight && index === currentWord
                ? "rounded bg-(--highlight-word)"
                : ""
            }
          >
            {word}
          </span>{" "}
        </Fragment>
      ))}
    </p>
  ));
});
