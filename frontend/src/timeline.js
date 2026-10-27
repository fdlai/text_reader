// A document's audio is one file per chunk. These helpers treat the chunks as
// one continuous timeline, converting between a position in the whole
// document and a (chunk index, offset within that chunk) pair.

// Seconds of speech per character, used before any audio exists to measure.
const DEFAULT_SECONDS_PER_CHAR = 0.065;

// chunks: [{ id, char_count }], durations: { [chunkId]: seconds }
// Chunks without audio yet get an estimated length based on the speaking
// pace of the chunks that do have audio.
export function buildTimeline(chunks, durations) {
  let knownSeconds = 0;
  let knownChars = 0;
  for (const chunk of chunks) {
    if (chunk.id in durations) {
      knownSeconds += durations[chunk.id];
      knownChars += chunk.char_count;
    }
  }
  const secondsPerChar = knownChars
    ? knownSeconds / knownChars
    : DEFAULT_SECONDS_PER_CHAR;

  const starts = [];
  let total = 0;
  for (const chunk of chunks) {
    starts.push(total);
    total += durations[chunk.id] ?? chunk.char_count * secondsPerChar;
  }

  return {
    starts,
    total,
    exact: chunks.every((chunk) => chunk.id in durations),
  };
}

export function chunkLength(timeline, index) {
  const end = timeline.starts[index + 1] ?? timeline.total;
  return end - timeline.starts[index];
}

// Index of the word being spoken at `offset` seconds, given each word's start
// time (sorted). Binary search, since this runs many times a second.
export function wordIndexAt(wordTimes, offset) {
  let low = 0;
  let high = wordTimes.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (wordTimes[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export function toPosition(timeline, index, offset) {
  return (timeline.starts[index] ?? 0) + offset;
}

export function fromPosition(timeline, position) {
  const clamped = Math.min(Math.max(position, 0), timeline.total);
  let index = 0;
  while (
    index < timeline.starts.length - 1 &&
    timeline.starts[index + 1] <= clamped
  ) {
    index++;
  }
  return { index, offset: clamped - timeline.starts[index] };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
