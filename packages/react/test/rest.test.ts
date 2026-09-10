import { afterEach, describe, expect, test, vi } from "vitest";

import { createRestClient } from "../src/rest.js";

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url.toString();
    return Response.json(handler(target, init ?? {}));
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rest client", () => {
  test("normalizes list responses from either page shape", async () => {
    stubFetch((url) => {
      if (url.includes("/items?")) {
        return {
          items: [
            { id: "i_1", title: "T", voteCount: 3 },
            { _id: "i_2", title: "U", voteCount: 1 },
          ],
          nextCursor: "cursor-1",
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    const client = createRestClient({ baseUrl: "http://x/api/userr" });
    const page = await client.listItems({ boardId: "b_1" });
    expect(page.items).toMatchObject([
      { id: "i_1", kind: "feedback" },
      { id: "i_2", voteCount: 1 },
    ]);
    expect(page.nextCursor).toBe("cursor-1");
  });

  test("surfaces backend errors with status context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 })),
    );
    const client = createRestClient({ baseUrl: "http://x/api/userr" });
    await expect(client.vote("i_1")).rejects.toThrow("nope");
  });

  test("forwards auth headers from getHeaders", async () => {
    const spy = stubFetch(() => ({ ok: true }));
    const client = createRestClient({
      baseUrl: "http://x/api/userr",
      getHeaders: () => ({ authorization: "Bearer token" }),
    });
    await client.unsubscribe("i_1");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token",
    );
  });

  test("findSimilar passes board and title through", async () => {
    const spy = stubFetch((url) => {
      expect(url).toContain("boardId=b_1");
      expect(url).toContain("title=");
      return { exact: null, similar: [] };
    });
    const client = createRestClient({ baseUrl: "http://x/api/userr" });
    await client.findSimilar({ boardId: "b_1", title: "dark mode" });
    expect(spy).toHaveBeenCalledOnce();
  });
});
