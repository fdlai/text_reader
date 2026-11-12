// Runs before every test file (see vite.config.js).
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom simulates a page but can't play audio, so these do nothing.
HTMLMediaElement.prototype.play = () => Promise.resolve();
HTMLMediaElement.prototype.pause = () => {};
HTMLMediaElement.prototype.load = () => {};
// Nor open <dialog>s as popups: here they just show.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
// Nor scroll, or answer questions about the screen (dark mode, reduced
// motion): here the answer is always no.
window.scrollTo = () => {};
window.scrollBy = () => {};
window.matchMedia = (query) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
});
// Nor does it make addresses for downloaded files (blobs).
URL.createObjectURL = () => "blob:test";
URL.revokeObjectURL = () => {};

afterEach(() => {
  cleanup(); // removes what the test rendered
  localStorage.clear();
});
