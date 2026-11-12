import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { listPronunciations, previewVoice } from "../api";
import { ConfirmContext } from "../context/confirm";
import { GenerationContext } from "../context/generation";
import { PlayerProvider } from "../context/PlayerContext";
import PronunciationsTab from "./PronunciationsTab";

vi.mock("../api", () => ({
  listPronunciations: vi.fn(),
  previewVoice: vi.fn(),
  createPronunciation: vi.fn(),
  updatePronunciation: vi.fn(),
  deletePronunciation: vi.fn(),
  // used by the player
  chunkAudioUrl: () => "",
  getAudioStatus: vi.fn(),
  saveProgress: vi.fn(() => Promise.resolve()),
  setDocumentVoice: vi.fn(() => Promise.resolve()),
  updateVoiceSpeed: vi.fn(),
}));

const VOICE = {
  id: 1,
  name: "Michael",
  engine: "kokoro",
  base_voice: "am_michael",
};

// A preview whose audio arrives only when the test says so.
function slowPreview() {
  let arrive;
  previewVoice.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
  return () => act(async () => arrive(new Blob(["mp3"])));
}

function renderTab() {
  return render(
    <GenerationContext.Provider value={{ paused: false }}>
      <ConfirmContext.Provider value={() => Promise.resolve(true)}>
        <PlayerProvider>
          <PronunciationsTab voice={VOICE} />
        </PlayerProvider>
      </ConfirmContext.Provider>
    </GenerationContext.Provider>,
  );
}

async function startPreview() {
  fireEvent.change(screen.getByPlaceholderText(/Sounds like/), {
    target: { value: "Her-my-oh-nee" },
  });
  fireEvent.click(screen.getByRole("button", { name: "▶ Preview" }));
  await screen.findByRole("button", { name: "Loading..." });
}

let play;
beforeEach(() => {
  listPronunciations.mockResolvedValue([]);
  play = vi.spyOn(HTMLMediaElement.prototype, "play");
  play.mockClear();
});

it("plays the respelling, said twice, in the reader's voice", async () => {
  const arrive = slowPreview();
  renderTab();
  await startPreview();
  expect(previewVoice).toHaveBeenCalledWith(
    expect.objectContaining({
      engine: "kokoro",
      base_voice: "am_michael",
      text: "Her-my-oh-nee. Once more: Her-my-oh-nee.",
    }),
  );
  await arrive();
  expect(play).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "▶ Preview" })).toBeTruthy();
});

it("doesn't play a preview that arrives after the panel closed", async () => {
  const arrive = slowPreview();
  const { unmount } = renderTab();
  await startPreview();
  unmount();
  await arrive();
  expect(play).not.toHaveBeenCalled();
});
