import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createDocument,
  deleteDocument,
  deleteDocuments,
  getCollection,
  listDocuments,
} from "../api";
import { renderApp } from "../test/renderApp";

vi.mock("../api", async (real) =>
  (await import("../test/fakeApi")).fakeApi(await real()),
);

const COUNTS = { all: 2, "not-started": 1, "in-progress": 1, finished: 0 };

function article(id, title, source_url = null) {
  return {
    id,
    title,
    source_url,
    has_cover: false,
    finished: false,
    fraction: 0,
    seconds_left: 600,
  };
}

const ARTICLES = [
  article(1, "Chapter 1", "https://novel.example.com/1"),
  article(2, "My notes"),
];

beforeEach(() => {
  vi.resetAllMocks();
  getCollection.mockResolvedValue({
    id: 7,
    name: "Mount Hua",
    document_count: 2,
  });
  listDocuments.mockResolvedValue({
    items: ARTICLES,
    total: 2,
    counts: COUNTS,
  });
});

async function openCollection() {
  renderApp("/collections/7");
  await screen.findByText("Chapter 1");
}

async function addUrl(url) {
  fireEvent.change(screen.getByPlaceholderText("https://…"), {
    target: { value: url },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

it("lists the articles, with their address or “Your text”", async () => {
  await openCollection();
  expect(screen.getByRole("heading", { name: "Mount Hua" })).toBeTruthy();
  expect(screen.getByText("https://novel.example.com/1")).toBeTruthy();
  expect(screen.getByText("Your text")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /My notes/ }).getAttribute("href"),
  ).toBe("/documents/2");
});

it("adds an article by its address", async () => {
  await openCollection();
  await addUrl("https://novel.example.com/2");
  await waitFor(() =>
    expect(createDocument).toHaveBeenCalledWith(
      "https://novel.example.com/2",
      7,
    ),
  );
  // The list is loaded again to show it.
  await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(2));
});

it("links to an article that was already added", async () => {
  await openCollection();
  createDocument.mockRejectedValue(
    Object.assign(new Error("That page is already in “Mount Hua”."), {
      status: 409,
      detail: { document_id: 1 },
    }),
  );
  await addUrl("https://novel.example.com/1");
  expect(
    await screen.findByText("That page is already in “Mount Hua”."),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Open it" }).getAttribute("href"),
  ).toBe("/documents/1");
});

it("offers to paste the text when a page can't be read", async () => {
  await openCollection();
  createDocument.mockRejectedValue(
    Object.assign(new Error("No article text was found on that page."), {
      status: 422,
    }),
  );
  await addUrl("https://blocked.example.com/");
  const paste = await screen.findByRole("link", {
    name: "Paste its text instead",
  });
  expect(paste.getAttribute("href")).toBe("/collections/7/new");
});

it("filters by progress with the tabs", async () => {
  await openCollection();
  const tabs = screen.getByRole("group", { name: "Show" });
  fireEvent.click(within(tabs).getByRole("button", { name: /In progress/ }));
  await waitFor(() =>
    expect(listDocuments).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ progress: "in-progress" }),
    ),
  );
});

it("deletes one article after asking", async () => {
  await openCollection();
  const row = screen.getByRole("link", { name: /Chapter 1/ }).closest("li");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Delete article?")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith(1));
});

it("selects several articles and deletes them together", async () => {
  await openCollection();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  for (const checkbox of screen.getAllByRole("checkbox"))
    fireEvent.click(checkbox);
  expect(screen.getByText("2 selected")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete 2 articles" }),
  );
  await waitFor(() => expect(deleteDocuments).toHaveBeenCalledWith([1, 2]));
});

it("leaves Select mode with Escape", async () => {
  await openCollection();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  // To the page, as a key press with nothing focused is.
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0),
  );
});
