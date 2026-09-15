import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubClient } from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("GithubClient.request", () => {
  it("retries a dropped connection and then succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("read ECONNRESET"), {
            code: "ECONNRESET",
          }),
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(ok({ login: "me", id: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GithubClient("test-only");
    await expect(client.user()).resolves.toEqual({ login: "me", id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("(ECONNRESET), attempt 1 of 3"),
    );
  });

  it("names the cause when every attempt fails to connect", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo EAI_AGAIN"), {
          code: "EAI_AGAIN",
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new GithubClient("test-only");
    await expect(client.user()).rejects.toThrow(
      "Could not reach GitHub (EAI_AGAIN). Check the server connection and run the import again.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a server error that outlasts the retries as HTTP", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    const client = new GithubClient("test-only");
    await expect(client.user()).rejects.toThrow("GitHub returned HTTP 503");
  });

  it("does not retry a client error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GithubClient("test-only");
    await expect(client.user()).rejects.toThrow("unavailable to this token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
