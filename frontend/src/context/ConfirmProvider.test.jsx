import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useConfirm } from "./confirm";
import ConfirmProvider from "./ConfirmProvider";

// A button that asks for confirmation and shows the answer.
function DeleteButton() {
  const confirm = useConfirm();
  return (
    <button
      onClick={async (e) => {
        const button = e.currentTarget;
        const answer = await confirm({
          title: "Delete article?",
          message: "Gone for good.",
        });
        button.dataset.answer = String(answer);
      }}
    >
      Delete
    </button>
  );
}

function openConfirm() {
  render(
    <ConfirmProvider>
      <DeleteButton />
    </ConfirmProvider>,
  );
  const button = screen.getByRole("button", { name: "Delete" });
  button.focus();
  fireEvent.click(button);
  return button;
}

it("starts with Cancel focused, so Enter by habit doesn't delete", async () => {
  openConfirm();
  expect(await screen.findByText("Delete article?")).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" }),
  );
});

it("answers true for the red button and false for Cancel", async () => {
  const button = openConfirm();
  await act(async () =>
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]),
  );
  expect(button.dataset.answer).toBe("true");

  fireEvent.click(button);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
  );
  expect(button.dataset.answer).toBe("false");
});

it("answers false for Escape", async () => {
  const button = openConfirm();
  const dialog = document.querySelector("dialog");
  await act(async () =>
    fireEvent(dialog, new Event("cancel", { cancelable: true })),
  );
  expect(button.dataset.answer).toBe("false");
  expect(document.querySelector("dialog")).toBeNull();
});

it("gives keyboard focus back to the button that opened it", async () => {
  const button = openConfirm();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
  );
  expect(document.activeElement).toBe(button);
});
