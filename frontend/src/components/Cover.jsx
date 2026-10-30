import { useState } from "react";
import { coverUrl } from "../api";

// A number from the title, so each article keeps the same placeholder color.
export function hue(title) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

// An article's cover image in a fixed-size box. Images of any shape fill it
// and are cropped to fit (object-cover), so every row lines up. Articles
// without an image get a tile with their first letter instead. size is the
// box's Tailwind size classes.
export default function Cover({ doc, size = "h-20 w-16 text-2xl" }) {
  const [failed, setFailed] = useState(false);
  const box = `${size} shrink-0 overflow-hidden rounded-md`;

  if (doc.has_cover && !failed) {
    return (
      <img
        src={coverUrl(doc.id)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${box} bg-gray-100 object-cover`}
      />
    );
  }
  // The first letter or digit, skipping quotes and other symbols.
  const letter = doc.title.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() ?? "?";
  return (
    <div
      aria-hidden="true"
      // See-through, so it suits both light and dark themes.
      style={{ backgroundColor: `hsl(${hue(doc.title)} 60% 50% / 0.25)` }}
      className={`${box} flex items-center justify-center font-semibold text-gray-600`}
    >
      {letter}
    </div>
  );
}
