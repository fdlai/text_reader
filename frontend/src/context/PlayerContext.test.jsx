import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAudioStatus, saveProgress } from "../api";
import { GenerationContext } from "./generation";
import { readyAudio } from "../timeline";
import { PlayerProvider, usePlayer } from "./PlayerContext";

// The player talks to the server through api.js; here it gets stand-ins.
vi.mock("../api", () => ({
  getAudioStatus: vi.fn(),
  chunkAudioUrl: (chunkId) => `/audio/${chunkId}`,
  saveProgress: vi.fn(() => Promise.resolve()),
  setDocumentVoice: vi.fn(() => Promise.resolve()),
  updateVoiceSpeed: vi.fn(() => Promise.resolve()),
}));

const SESSION = {
  documentId: 1,
  presetId: 2,
  title: "Chapter 1",
  chunks: [
    { id: 10, index: 0, char_count: 300 },
    { id: 11, index: 1, char_count: 400 },
  ],
};

// An audio status from the server: which chunks are ready.
function status(readyIds, generating = true) {
  return {
    generating,
    chunks: SESSION.chunks.map((c) => ({
      chunk_id: c.id,
      ready: readyIds.includes(c.id),
      duration_sec: readyIds.includes(c.id) ? 20 : null,
      audio_id: readyIds.includes(c.id) ? c.id * 100 : null,
    })),
  };
}

// Renders the player and returns a function giving its current state.
function renderPlayer({ paused = false } = {}) {
  const { result } = renderHook(() => usePlayer(), {
    wrapper: ({ children }) => (
      <GenerationContext.Provider value={{ paused }}>
        <PlayerProvider>{children}</PlayerProvider>
      </GenerationContext.Provider>
    ),
  });
  return () => result.current;
}

// Plays the second chunk, whose audio isn't made yet.
function playUnmadeChunk(player) {
  act(() => player().load(SESSION, readyAudio(status([10])), 1, 1));
}

async function wait(ms) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  getAudioStatus.mockReset();
  saveProgress.mockClear();
});

// Loads both chunks with audio (20 s each, so 40 s in all).
function playReadyArticle(player, startIndex = 0, startOffset = 0) {
  act(() =>
    player().load(
      SESSION,
      readyAudio(status([10, 11])),
      startIndex,
      1,
      startOffset,
    ),
  );
}

const audioEnds = () =>
  act(() => fireEvent.ended(document.querySelector("audio")));

describe("playing through an article", () => {
  it("goes on to the next section when one ends", () => {
    const player = renderPlayer();
    playReadyArticle(player);
    audioEnds();
    expect(player().index).toBe(1);
    expect(player().playing).toBe(true);
  });

  it("stays at the end, finished, when the last section ends", () => {
    const player = renderPlayer();
    playReadyArticle(player, 1);
    audioEnds();
    expect(player().finished).toBe(true);
    expect(player().playing).toBe(false);
    expect(player().position).toBe(20); // the start of the last section
  });

  it("finishes when skipped or dragged to the very end", () => {
    const player = renderPlayer();
    playReadyArticle(player);
    act(() => player().seekTo(40));
    expect(player().finished).toBe(true);
  });

  it("starts over when Play is pressed on a finished article", () => {
    const player = renderPlayer();
    playReadyArticle(player);
    act(() => player().seekTo(40));
    act(() => player().toggle());
    expect(player().finished).toBe(false);
    expect(player().playing).toBe(true);
    expect(player().position).toBe(0);
  });

  it("skips by seconds across sections", () => {
    const player = renderPlayer();
    playReadyArticle(player, 0, 18);
    act(() => player().skip(5));
    expect([player().index, player().offset]).toEqual([1, 3]);
  });
});

describe("saving the listening position", () => {
  it("saves once shortly after several quick skips, not once per skip", async () => {
    const player = renderPlayer();
    playReadyArticle(player);
    for (let i = 0; i < 4; i++) act(() => player().skip(5));
    await wait(1000);
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress).toHaveBeenCalledWith(1, 1, 0, false);
  });

  it("doesn't save the position it was loaded at", async () => {
    const player = renderPlayer();
    act(() =>
      player().load(SESSION, readyAudio(status([10, 11])), 1, 1, 5, false),
    );
    await wait(5000);
    expect(saveProgress).not.toHaveBeenCalled();
  });

  it("saves when the tab is hidden", () => {
    const player = renderPlayer();
    playReadyArticle(player);
    act(() => player().skip(5));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(saveProgress).toHaveBeenCalledWith(1, 0, 5, false);
  });
});

afterEach(() => vi.useRealTimers());

describe("readyAudio", () => {
  it("keeps only the chunks with audio, by chunk id", () => {
    expect(readyAudio(status([10]))).toEqual({
      10: { duration: 20, audioId: 1000 },
    });
  });
});

describe("waiting for a section that isn't made yet", () => {
  it("checks until it's ready, then plays on, without the Reader open", async () => {
    getAudioStatus
      .mockResolvedValueOnce(status([10]))
      .mockResolvedValueOnce(status([10, 11]));
    const player = renderPlayer();
    playUnmadeChunk(player);
    expect(player().waiting).toBe(true);

    await wait(3000);
    expect(getAudioStatus).toHaveBeenCalledWith(1, 2);
    expect(player().waiting).toBe(true);

    await wait(3000);
    expect(player().waiting).toBe(false);
    expect(player().playing).toBe(true);

    // Once it's no longer waiting, it stops checking.
    await wait(10000);
    expect(getAudioStatus).toHaveBeenCalledTimes(2);
  });

  it("stops checking when nothing is being generated", async () => {
    getAudioStatus.mockResolvedValue(status([10], false));
    const player = renderPlayer();
    playUnmadeChunk(player);
    await wait(20000);
    expect(getAudioStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps trying after a failed check", async () => {
    getAudioStatus
      .mockRejectedValueOnce(new Error("Server restarting"))
      .mockResolvedValueOnce(status([10, 11]));
    const player = renderPlayer();
    playUnmadeChunk(player);
    await wait(3000 + 6000);
    expect(player().waiting).toBe(false);
  });

  it("doesn't check while generation is paused", async () => {
    const player = renderPlayer({ paused: true });
    playUnmadeChunk(player);
    await wait(20000);
    expect(getAudioStatus).not.toHaveBeenCalled();
  });
});
