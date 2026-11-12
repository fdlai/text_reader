import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTextDocument,
  getCollection,
  getDocumentText,
  updateDocumentText,
} from "../api";
import { ConfirmContext } from "../context/confirm";
import { GenerationContext } from "../context/generation";
import { PlayerProvider } from "../context/PlayerContext";
import TextEditor from "./TextEditor";

vi.mock("../api", () => ({
  getCollection: vi.fn(),
  getDocumentText: vi.fn(),
  createTextDocument: vi.fn(),
  updateDocumentText: vi.fn(),
  // used by the player
  chunkAudioUrl: () => "",
  getAudioStatus: vi.fn(),
  saveProgress: vi.fn(() => Promise.resolve()),
  setDocumentVoice: vi.fn(() => Promise.resolve()),
  updateVoiceSpeed: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;

// Opens the editor at a page address, e.g. "/collections/3/new".
function openEditor(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <GenerationContext.Provider value={{ paused: false }}>
        <ConfirmContext.Provider value={() => Promise.resolve(true)}>
          <PlayerProvider>
            <Routes>
              <Route path="/collections/:id/new" element={<TextEditor />} />
              <Route
                path="/documents/:id/edit"
                element={<TextEditor editing />}
              />
              <Route path="/documents/:id" element={<p>Article page</p>} />
            </Routes>
          </PlayerProvider>
        </ConfirmContext.Provider>
      </GenerationContext.Provider>
    </MemoryRouter>,
  );
}

const textBox = () => screen.getByLabelText("Text");
const type = (box, value) => fireEvent.change(box, { target: { value } });
const savedDraft = (key) => JSON.parse(localStorage.getItem(key));

beforeEach(() => {
  vi.clearAllMocks();
  getCollection.mockResolvedValue({ id: 3, name: "My Novel" });
});

describe("a new article", () => {
  it("keeps what you type as a draft, shortly after you stop", async () => {
    openEditor("/collections/3/new");
    type(textBox(), "Dear diary.");
    await waitFor(() =>
      expect(savedDraft("draft:new:3")?.text).toBe("Dear diary."),
    );
  });

  it("offers to restore a draft from last time", async () => {
    localStorage.setItem(
      "draft:new:3",
      JSON.stringify({
        title: "",
        text: "Unsaved words.",
        savedAt: Date.now(),
      }),
    );
    openEditor("/collections/3/new");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(textBox().value).toBe("Unsaved words.");
  });

  it("removes drafts older than a week", () => {
    const old = { title: "", text: "Ancient.", savedAt: Date.now() - 8 * DAY };
    localStorage.setItem("draft:new:9", JSON.stringify(old));
    openEditor("/collections/3/new");
    expect(localStorage.getItem("draft:new:9")).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("is saved to the collection and opened, and its draft removed", async () => {
    createTextDocument.mockResolvedValue({ id: 42 });
    openEditor("/collections/3/new");
    type(textBox(), "Dear diary.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Article page")).toBeTruthy();
    expect(createTextDocument).toHaveBeenCalledWith("", "Dear diary.", 3);
    await new Promise((r) => setTimeout(r, 600)); // past the draft delay
    expect(localStorage.getItem("draft:new:3")).toBeNull();
  });

  it("can't be saved empty or too long", () => {
    openEditor("/collections/3/new");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.disabled).toBe(true);
    type(textBox(), "x".repeat(500_001));
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/too long for one article/)).toBeTruthy();
  });
});

describe("editing an article", () => {
  it("shows a blank line between paragraphs", async () => {
    getDocumentText.mockResolvedValue({
      title: "Ch 1",
      text: "One.\nTwo.\n\n\nThree.",
    });
    openEditor("/documents/7/edit");
    await waitFor(() => expect(textBox().value).toBe("One.\n\nTwo.\n\nThree."));
  });

  it("saves the changed text", async () => {
    getDocumentText.mockResolvedValue({ title: "Ch 1", text: "One." });
    updateDocumentText.mockResolvedValue({ changed: 1, first_changed: 0 });
    openEditor("/documents/7/edit");
    await waitFor(() => expect(textBox().value).toBe("One."));
    type(textBox(), "One, edited.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Article page")).toBeTruthy();
    expect(updateDocumentText).toHaveBeenCalledWith(7, "Ch 1", "One, edited.");
  });

  it("doesn't offer a draft that matches what's saved", async () => {
    localStorage.setItem(
      "draft:edit:7",
      JSON.stringify({ title: "Ch 1", text: "One.", savedAt: Date.now() }),
    );
    getDocumentText.mockResolvedValue({ title: "Ch 1", text: "One." });
    openEditor("/documents/7/edit");
    await waitFor(() => expect(textBox().value).toBe("One."));
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});
