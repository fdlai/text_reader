import { describe, expect, it } from "vitest";
import { takeEditNotice, setEditNotice } from "./editNotice";
import { defaultVoiceId, kokoroDetail, sortVoices } from "./engines";
import { collectionPath, editPath, newTextPath } from "./paths";

const VOICES = [
  { id: 1, name: "Narrator", engine: "openai", base_voice: "coral" },
  { id: 2, name: "Michael", engine: "kokoro", base_voice: "am_michael" },
  { id: 3, name: "Emma", engine: "kokoro", base_voice: "bf_emma" },
  { id: 4, name: "Alice", engine: "kokoro", base_voice: "af_alice" },
  { id: 5, name: "Zed", engine: "qwen", base_voice: "9" },
  { id: 6, name: "Chris", engine: "qwen", base_voice: "7" },
];

describe("sortVoices", () => {
  it("keeps Kokoro voices grouped by accent and gender", () => {
    expect(sortVoices(VOICES, "kokoro").map((v) => v.base_voice)).toEqual([
      "af_alice",
      "am_michael",
      "bf_emma",
    ]);
  });

  it("sorts the user's own voices by name", () => {
    expect(sortVoices(VOICES, "qwen").map((v) => v.name)).toEqual([
      "Chris",
      "Zed",
    ]);
  });
});

describe("defaultVoiceId", () => {
  it("is the chosen voice", () => {
    expect(defaultVoiceId(VOICES, 5)).toBe(5);
  });

  it("falls back to Michael when the chosen voice was deleted or none was chosen", () => {
    expect(defaultVoiceId(VOICES, 999)).toBe(2);
    expect(defaultVoiceId(VOICES, null)).toBe(2);
  });

  it("falls back to any voice without Michael, and to none without voices", () => {
    expect(defaultVoiceId([VOICES[0]], null)).toBe(1);
    expect(defaultVoiceId([], null)).toBeNull();
  });
});

it("kokoroDetail reads accent and gender from the voice id", () => {
  expect(kokoroDetail("bf_emma")).toBe("British · female");
  expect(kokoroDetail("am_michael")).toBe("American · male");
});

describe("edit notices", () => {
  it("are given to the edited article once", () => {
    setEditNotice(7, { changed: 2, first_changed: 4 });
    expect(takeEditNotice(8)).toBeNull();
    expect(takeEditNotice(7)).toEqual({
      documentId: 7,
      changed: 2,
      first_changed: 4,
    });
    expect(takeEditNotice(7)).toBeNull();
  });
});

describe("paths", () => {
  it("name Unsorted when there's no collection", () => {
    expect(collectionPath(null)).toBe("/collections/unsorted");
    expect(newTextPath(3)).toBe("/collections/3/new");
    expect(editPath(12)).toBe("/documents/12/edit");
  });
});
