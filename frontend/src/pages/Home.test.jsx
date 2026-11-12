import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createCollection, listCollections, listRecentDocuments } from "../api";
import { renderApp } from "../test/renderApp";

vi.mock("../api", async (real) =>
  (await import("../test/fakeApi")).fakeApi(await real()),
);

const novel = {
  id: 7,
  name: "Mount Hua",
  document_count: 71,
  in_progress_count: 1,
  stack: [],
};

// Back to the fake server's default answers.
beforeEach(() => vi.resetAllMocks());

it("shows the collections with their counts", async () => {
  listCollections.mockResolvedValue({ items: [novel], total: 1 });
  renderApp("/");
  const card = await screen.findByRole("link", { name: /Mount Hua/ });
  expect(card.textContent).toContain("71 articles · 1 in progress");
  expect(card.getAttribute("href")).toBe("/collections/7");
});

it("shows what's being listened to under Continue listening", async () => {
  listRecentDocuments.mockResolvedValue([
    {
      id: 3,
      title: "Chapter 3",
      has_cover: false,
      finished: false,
      fraction: 0.5,
      seconds_left: 300,
    },
  ]);
  renderApp("/");
  const row = await screen.findByRole("link", { name: /Chapter 3/ });
  expect(row.textContent).toContain("50% · 5 min left");
});

it("invites you to make a first collection when there are none", async () => {
  renderApp("/");
  expect(await screen.findByText(/Articles live in collections/)).toBeTruthy();
  expect(screen.queryByText("Continue listening")).toBeNull();
});

it("makes a new collection and opens it", async () => {
  createCollection.mockResolvedValue({ id: 9, name: "Dune" });
  renderApp("/");
  fireEvent.click(screen.getAllByRole("button", { name: "New collection" })[0]);
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "Dune" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

  await waitFor(() => expect(createCollection).toHaveBeenCalledWith("Dune"));
  // The collection page loads it next.
  expect(await screen.findByRole("heading", { name: "Novel" })).toBeTruthy();
});

it("searches the collections", async () => {
  listCollections.mockResolvedValue({ items: [novel], total: 1 });
  renderApp("/");
  const search = await screen.findByPlaceholderText("Search collections");
  listCollections.mockResolvedValue({ items: [], total: 0 });
  fireEvent.change(search, { target: { value: "dune" } });
  expect(await screen.findByText("No collections match “dune”.")).toBeTruthy();
  expect(listCollections).toHaveBeenLastCalledWith(
    expect.objectContaining({ q: "dune" }),
  );
});
