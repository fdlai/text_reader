// A stand-in for api.js in page tests, so no requests are made. Each
// function is a vi.fn() answering like a server with nothing in it; tests
// give the ones they care about other answers, e.g.
//   getDocument.mockResolvedValue({ ... })
// Functions that only build an address (chunkAudioUrl, coverUrl, ...) are
// the real ones.
//
// Used in a test file as:
//   vi.mock("../api", async (real) =>
//     (await import("../test/fakeApi")).fakeApi(await real()),
//   );
import { vi } from "vitest";
import { DEFAULTS } from "../context/preferences";

const EMPTY_COUNTS = {
  all: 0,
  "not-started": 0,
  "in-progress": 0,
  finished: 0,
};
const AVAILABLE = { available: true, reason: null };

const ANSWERS = {
  getPreferences: () => ({ ...DEFAULTS }),
  savePreferences: (prefs) => prefs,
  getGeneration: () => ({ paused: false, items: [], qwen_running: false }),
  getEngines: () => ({ kokoro: AVAILABLE, qwen: AVAILABLE, openai: AVAILABLE }),
  listVoices: () => [],
  listEngineVoices: () => ({ kokoro: [], openai: [], qwen: [] }),
  listCustomVoices: () => [],
  listCollections: () => ({ items: [], total: 0 }),
  listRecentDocuments: () => [],
  listDocuments: () => ({ items: [], total: 0, counts: EMPTY_COUNTS }),
  getCollection: () => ({ id: 1, name: "Novel", document_count: 0 }),
  getProgress: () => ({ chunk_index: 0, offset_sec: 0, finished: false }),
  getAudioStatus: () => ({
    generating: false,
    queue_position: null,
    error: null,
    notice: null,
    chunks: [],
  }),
  getVoiceAudio: () => [],
  listPronunciations: () => [],
};

export function fakeApi(real) {
  return Object.fromEntries(
    Object.entries(real).map(([name, fn]) => [
      name,
      name.endsWith("Url")
        ? fn
        : vi.fn(async () => (ANSWERS[name] ? ANSWERS[name]() : null)),
    ]),
  );
}
