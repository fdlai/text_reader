import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
} from "./api";

// Makes the next request get this response.
function respond(status, body) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}

async function errorFrom(call) {
  try {
    await call();
  } catch (e) {
    return e;
  }
  throw new Error("expected the request to fail");
}

afterEach(() => vi.unstubAllGlobals());

describe("requests", () => {
  it("go to the backend under /api and return the JSON", async () => {
    respond(200, { id: 3, title: "Chapter 3" });
    expect(await getDocument(3)).toEqual({ id: 3, title: "Chapter 3" });
    expect(fetch).toHaveBeenCalledWith("/api/documents/3", undefined);
  });

  it("return null for a response with no content", async () => {
    respond(204);
    expect(await deleteDocument(3)).toBeNull();
  });

  it("leave empty options out of a list's address", async () => {
    respond(200, { items: [], total: 0, counts: {} });
    await listDocuments(4, { page: 2, pageSize: 50, q: "" });
    const url = fetch.mock.calls[0][0];
    expect(url).toContain("collection_id=4");
    expect(url).toContain("page=2");
    expect(url).not.toContain("q=");
  });
});

describe("errors", () => {
  it("use the server's message", async () => {
    respond(404, { detail: "Document not found." });
    const error = await errorFrom(() => getDocument(999));
    expect(error.message).toBe("Document not found.");
    expect(error.status).toBe(404);
  });

  it("use the first validation problem's message", async () => {
    respond(422, { detail: [{ msg: "Input should be a valid URL" }] });
    const error = await errorFrom(() => createDocument("nope", null));
    expect(error.message).toBe("Input should be a valid URL");
  });

  it("keep extra details, such as where a page was already added", async () => {
    const detail = {
      message: "That page is already in “Novel”.",
      document_id: 12,
    };
    respond(409, { detail });
    const error = await errorFrom(() => createDocument("https://a.com", null));
    expect(error.message).toBe(detail.message);
    expect(error.detail.document_id).toBe(12);
  });

  it("still say something when the response isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("Bad Gateway", { status: 502 })),
      ),
    );
    const error = await errorFrom(() => getDocument(1));
    expect(error.message).toBe("Request failed (502)");
  });
});
