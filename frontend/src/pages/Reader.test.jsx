import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  generateAudio,
  getAudioStatus,
  getDocument,
  getDocumentText,
  getProgress,
  listVoices,
  regenerateOutdated,
} from "../api";
import { setEditNotice } from "../editNotice";
import { renderApp } from "../test/renderApp";

vi.mock("../api", async (real) =>
  (await import("../test/fakeApi")).fakeApi(await real()),
);

const MICHAEL = {
  id: 5,
  name: "Michael",
  engine: "kokoro",
  base_voice: "am_michael",
  instructions: "",
  speed: 1,
};

const DOC = {
  id: 3,
  title: "Chapter 3",
  source_url: "https://novel.example.com/3",
  created_at: "2026-11-12T10:00:00Z",
  collection_id: 7,
  collection_name: "Mount Hua",
  next_url: null,
  next_document_id: null,
  voice_preset_id: 5,
  has_cover: false,
  chunks: [
    {
      id: 30,
      index: 0,
      char_count: 30,
      paragraphs: [["The", "story", "begins."]],
    },
    { id: 31, index: 1, char_count: 30, paragraphs: [["It", "goes", "on."]] },
  ],
};

// The audio status: which chunks (by id) have audio, and which of those
// are outdated.
function audioStatus(ready, { outdated = [], generating = false } = {}) {
  return {
    generating,
    queue_position: generating ? 0 : null,
    error: null,
    notice: null,
    chunks: DOC.chunks.map((c) => ({
      chunk_id: c.id,
      index: c.index,
      ready: ready.includes(c.id),
      audio_id: ready.includes(c.id) ? c.id * 10 : null,
      duration_sec: ready.includes(c.id) ? 10 : null,
      word_times: ready.includes(c.id) ? [0, 0.4, 0.8] : null,
      outdated: outdated.includes(c.id),
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getDocument.mockResolvedValue(DOC);
  listVoices.mockResolvedValue([MICHAEL]);
  getAudioStatus.mockResolvedValue(audioStatus([30, 31]));
});

// Opens the article and waits until it has finished loading, as a person
// would before clicking anything. The page shows the article as soon as
// it's loaded; the effects that follow (setting the tab's title, loading it
// into the player) run a moment later.
async function openArticle() {
  renderApp("/documents/3");
  await screen.findByRole("heading", { name: "Chapter 3" });
  await waitFor(() => expect(document.title).toBe("Chapter 3 · Audifire"));
}

// With audio, opening the article also loads it into the player, paused
// where listening left off, so the player bar shows that position.
async function openArticleWithAudio(position = "Section 1 of 2") {
  await openArticle();
  const bar = () => document.querySelector("[data-player-bar]");
  await waitFor(() => expect(bar()?.textContent).toContain(position));
}

// The big round button at the top of the article. (Found by its title,
// which is exactly its label: the player bar's buttons add a shortcut,
// e.g. "Pause (Space)".)
const mainButton = (label) => screen.findByTitle(label);

it("shows the article's title, collection and text", async () => {
  await openArticle();
  expect(screen.getAllByText("Mount Hua").length).toBeGreaterThan(0);
  expect(screen.getByText("begins.")).toBeTruthy();
  expect(screen.getByText("goes")).toBeTruthy();
});

it("says so when the article can't be loaded", async () => {
  getDocument.mockRejectedValue(new Error("Document not found."));
  renderApp("/documents/3");
  expect(await screen.findByText("Document not found.")).toBeTruthy();
});

it("is ready to play from the start, and plays", async () => {
  await openArticleWithAudio("Section 1 of 2");
  fireEvent.click(await mainButton("Play"));
  expect(await mainButton("Pause")).toBeTruthy();
});

it("continues from where listening left off", async () => {
  getProgress.mockResolvedValue({
    chunk_index: 1,
    offset_sec: 4,
    finished: false,
  });
  await openArticleWithAudio("Section 2 of 2");
  fireEvent.click(await mainButton("Continue"));
  expect(await mainButton("Pause")).toBeTruthy();
});

it("offers to listen again once finished", async () => {
  getProgress.mockResolvedValue({
    chunk_index: 1,
    offset_sec: 10,
    finished: true,
  });
  await openArticleWithAudio("Finished");
  fireEvent.click(await mainButton("Listen again"));
  expect(await screen.findByText("Section 1 of 2")).toBeTruthy();
});

it("generates the audio when there is none yet", async () => {
  getAudioStatus.mockResolvedValue(audioStatus([]));
  await openArticle();
  fireEvent.click(await mainButton("Generate audio"));
  await waitFor(() => expect(generateAudio).toHaveBeenCalledWith(3, 5, false));
});

it("waits while the first section is being made", async () => {
  getAudioStatus.mockResolvedValue(audioStatus([], { generating: true }));
  await openArticle();
  const button = await mainButton("Preparing audio");
  expect(button.disabled).toBe(true);
});

it("offers to remake sections made with older settings", async () => {
  getAudioStatus.mockResolvedValue(audioStatus([30, 31], { outdated: [31] }));
  await openArticle();
  expect(await screen.findByText(/1 section was made with/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Regenerate it" }));
  await waitFor(() => expect(regenerateOutdated).toHaveBeenCalledWith(3, 5));
});

it("after an edit, says what changed and can play from there", async () => {
  setEditNotice(3, { changed: 1, first_changed: 1 });
  await openArticleWithAudio();
  expect(
    await screen.findByText("Text updated: 1 section changed."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Go to changes" }));
  expect(await screen.findByText("Section 2 of 2")).toBeTruthy();
});

it("opens the editor from the ⋯ menu", async () => {
  getDocumentText.mockResolvedValue({
    title: "Chapter 3",
    text: "The story begins.\nIt goes on.",
  });
  await openArticle();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit text" }));
  expect(
    await screen.findByRole("heading", { name: "Edit article" }),
  ).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByLabelText("Text").value).toBe(
      "The story begins.\n\nIt goes on.",
    ),
  );
});

// Selects a word, as if by mouse, on a 320 px wide screen where the popup
// (200 px wide) would start at `popupLeft` before being moved. jsdom has no
// layout, so the sizes are made up: the popup's moves with its margin, as
// in a browser.
async function selectWordWithPopupAt(popupLeft) {
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: 320,
    configurable: true,
  });
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 300, 40, 20);
  const realRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      if (this.lastElementChild?.textContent !== "Fix pronunciation") {
        return realRect.call(this);
      }
      const left = popupLeft + (parseFloat(this.style.marginLeft) || 0);
      return new DOMRect(left, 260, 200, 32);
    },
  );
  await openArticleWithAudio();
  const range = document.createRange();
  range.selectNodeContents(screen.getByText("story"));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  fireEvent.mouseUp(document);
  const fix = await screen.findByRole("button", { name: "Fix pronunciation" });
  return fix.parentElement;
}

function restoreLayout() {
  delete document.documentElement.clientWidth;
  delete Range.prototype.getBoundingClientRect;
  vi.restoreAllMocks();
}

it("keeps the selection popup on screen near the left edge", async () => {
  try {
    const popup = await selectWordWithPopupAt(-60);
    // From -60 to 8 px: the margin from the screen's edge.
    expect(popup.style.marginLeft).toBe("68px");
  } finally {
    restoreLayout();
  }
});

it("keeps the selection popup on screen near the right edge", async () => {
  try {
    const popup = await selectWordWithPopupAt(200);
    // Its right side, at 400 px, moves to 312 px.
    expect(popup.style.marginLeft).toBe("-88px");
  } finally {
    restoreLayout();
  }
});

it("leaves the selection popup alone when it fits", async () => {
  try {
    const popup = await selectWordWithPopupAt(60);
    expect(popup.style.marginLeft).toBe("0px");
  } finally {
    restoreLayout();
  }
});

it("goes back to the current word while text is selected", async () => {
  try {
    // Selecting text stops following, which offers "Back to current".
    await selectWordWithPopupAt(60);
    const back = screen.getByRole("button", { name: "Back to current" });
    // The press doesn't clear the selection (as in Chrome), and its mouseup
    // reaches the page too.
    fireEvent.mouseUp(back);
    fireEvent.click(back);
    // Long enough for the selection handler's wait.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Back to current" })).toBe(
      null,
    );
  } finally {
    restoreLayout();
  }
});

it("shows the voice and lists the others in the voice menu", async () => {
  await openArticle();
  const voiceButton = await screen.findByRole("button", { name: /Michael/ });
  fireEvent.click(voiceButton);
  const menu = voiceButton.parentElement;
  expect(within(menu).getByRole("button", { name: "Kokoro" })).toBeTruthy();
  expect(within(menu).getByRole("button", { name: "OpenAI" })).toBeTruthy();
});
