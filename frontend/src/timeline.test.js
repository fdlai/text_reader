import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  chunkLength,
  formatTime,
  fromPosition,
  toPosition,
  wordIndexAt,
} from "./timeline";

const CHUNKS = [
  { id: 1, char_count: 100 },
  { id: 2, char_count: 200 },
  { id: 3, char_count: 300 },
];

describe("buildTimeline", () => {
  it("lays the chunks end to end when all have audio", () => {
    const timeline = buildTimeline(CHUNKS, { 1: 10, 2: 20, 3: 30 });
    expect(timeline).toEqual({ starts: [0, 10, 30], total: 60, exact: true });
  });

  it("estimates chunks without audio from the pace of those with it", () => {
    // 10 seconds for 100 characters: 0.1 s each, so 300 characters is 30 s.
    const timeline = buildTimeline(CHUNKS, { 1: 10, 2: 20 });
    expect(timeline.total).toBeCloseTo(60);
    expect(timeline.exact).toBe(false);
  });

  it("uses a typical pace before any audio exists", () => {
    const timeline = buildTimeline(CHUNKS, {});
    expect(timeline.total).toBeCloseTo(600 * 0.065);
  });
});

describe("positions", () => {
  const timeline = buildTimeline(CHUNKS, { 1: 10, 2: 20, 3: 30 });

  it("convert between the whole article and a place in one chunk", () => {
    expect(toPosition(timeline, 1, 5)).toBe(15);
    expect(fromPosition(timeline, 15)).toEqual({ index: 1, offset: 5 });
  });

  it("a position on a boundary is the start of the next chunk", () => {
    expect(fromPosition(timeline, 30)).toEqual({ index: 2, offset: 0 });
  });

  it("positions outside the article are kept to its start and end", () => {
    expect(fromPosition(timeline, -5)).toEqual({ index: 0, offset: 0 });
    expect(fromPosition(timeline, 999)).toEqual({ index: 2, offset: 30 });
  });

  it("chunkLength is each chunk's share of the timeline", () => {
    expect([0, 1, 2].map((i) => chunkLength(timeline, i))).toEqual([
      10, 20, 30,
    ]);
  });
});

describe("wordIndexAt", () => {
  const times = [0, 0.4, 0.9, 1.5];

  it("finds the word being spoken", () => {
    expect(wordIndexAt(times, 0.5)).toBe(1);
    expect(wordIndexAt(times, 0.9)).toBe(2);
    expect(wordIndexAt(times, 10)).toBe(3);
  });

  it("is the first word before any has started", () => {
    expect(wordIndexAt(times, -1)).toBe(0);
  });
});

describe("formatTime", () => {
  it.each([
    [0, "0:00"],
    [9.6, "0:10"],
    [75, "1:15"],
    [3600 + 62, "1:01:02"],
    [-3, "0:00"],
  ])("%s seconds is %s", (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });
});
