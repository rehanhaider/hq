import { describe, expect, it } from "vitest";
import { fetchLinkPreview, isPublicAddress, isPublicHostname } from "./linkPreview";

const PAGE = `<html><head>
  <title>Doc title</title>
  <meta property="og:title" content="OG title">
  <meta property="og:description" content="A description">
  <meta property="og:site_name" content="Example">
  <meta property="og:image" content="https://example.com/og.png">
</head><body></body></html>`;

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  routes: Record<string, () => Response>,
  calls: Call[] = [],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("missing", { status: 404 });
    return route();
  }) as typeof fetch;
}

const html = (body: string, contentType = "text/html; charset=utf-8") =>
  new Response(body, { status: 200, headers: { "content-type": contentType } });

const publicLookup = async () => ["93.184.216.34"];

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local, CGNAT, multicast, and IPv6 equivalents", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "not an ip",
    ])
      expect(isPublicAddress(address), address).toBe(false);
  });

  it("accepts public addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
  });
});

describe("isPublicHostname", () => {
  it("refuses localhost, local suffixes, and private literals", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "app.localhost",
      "printer.local",
      "db.internal",
      "nas.home.arpa",
      "127.0.0.1",
      "[::1]",
      "",
    ])
      expect(isPublicHostname(host), host).toBe(false);
    expect(isPublicHostname("example.com")).toBe(true);
    expect(isPublicHostname("example.com.")).toBe(true);
  });
});

describe("fetchLinkPreview", () => {
  it("reads Open Graph tags from the page", async () => {
    const calls: Call[] = [];
    const data = await fetchLinkPreview("https://example.com/post#frag", {
      fetchImpl: fakeFetch({ "https://example.com/post": () => html(PAGE) }, calls),
      lookup: publicLookup,
    });
    expect(data).toEqual({
      url: "https://example.com/post",
      title: "OG title",
      description: "A description",
      siteName: "Example",
      image: { url: "https://example.com/og.png", width: 0, height: 0 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(new Headers(calls[0]?.init?.headers).get("accept")).toContain("text/html");
  });

  it("follows redirects and links the card to the final URL", async () => {
    const calls: Call[] = [];
    const data = await fetchLinkPreview("http://example.com/old", {
      fetchImpl: fakeFetch(
        {
          "http://example.com/old": () =>
            new Response(null, { status: 301, headers: { location: "/new" } }),
          "http://example.com/new": () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            }),
          "https://example.com/final": () => html(PAGE),
        },
        calls,
      ),
      lookup: publicLookup,
    });
    expect(data.url).toBe("https://example.com/final");
    expect(calls.map((call) => call.url)).toEqual([
      "http://example.com/old",
      "http://example.com/new",
      "https://example.com/final",
    ]);
  });

  it("gives up after too many redirects", async () => {
    await expect(
      fetchLinkPreview("https://example.com/loop", {
        fetchImpl: fakeFetch({
          "https://example.com/loop": () =>
            new Response(null, { status: 302, headers: { location: "/loop" } }),
        }),
        lookup: publicLookup,
      }),
    ).rejects.toThrow(/too many/);
  });

  it("merges an oEmbed answer discovered on the page", async () => {
    const page = `<html><head>
      <link rel="alternate" type="application/json+oembed" href="https://example.com/oembed?u=1">
    </head></html>`;
    const data = await fetchLinkPreview("https://example.com/video", {
      fetchImpl: fakeFetch({
        "https://example.com/video": () => html(page),
        "https://example.com/oembed?u=1": () =>
          new Response(
            JSON.stringify({
              title: "A video",
              author_name: "Alice",
              provider_name: "Vid",
              thumbnail_url: "https://cdn.example.com/t.jpg",
              html: "<iframe></iframe>",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      }),
      lookup: publicLookup,
    });
    expect(data).toEqual({
      url: "https://example.com/video",
      title: "A video",
      description: "By Alice",
      siteName: "Vid",
      image: { url: "https://cdn.example.com/t.jpg", width: 0, height: 0 },
    });
  });

  it("still returns the page tags when the oEmbed endpoint fails", async () => {
    const page = `<html><head>
      <title>Only a title</title>
      <link rel="alternate" type="application/json+oembed" href="https://example.com/oembed">
    </head></html>`;
    const data = await fetchLinkPreview("https://example.com/", {
      fetchImpl: fakeFetch({
        "https://example.com/": () => html(page),
        "https://example.com/oembed": () => new Response("nope", { status: 500 }),
      }),
      lookup: publicLookup,
    });
    expect(data.title).toBe("Only a title");
    expect(data.image).toBeNull();
  });

  it("refuses private hosts, on the first URL and after a redirect", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch(
      {
        "https://example.com/hop": () =>
          new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/" } }),
      },
      calls,
    );
    await expect(
      fetchLinkPreview("http://localhost:3000/", { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("https://intranet.example/", {
        fetchImpl,
        lookup: async () => ["10.0.0.5"],
      }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("https://example.com/hop", { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow(/local/);
    expect(calls.map((call) => call.url)).toEqual(["https://example.com/hop"]);
  });

  it("refuses a host with no addresses or a failed lookup", async () => {
    const fetchImpl = fakeFetch({ "https://example.com/": () => html(PAGE) });
    await expect(
      fetchLinkPreview("https://example.com/", { fetchImpl, lookup: async () => [] }),
    ).rejects.toThrow();
    await expect(
      fetchLinkPreview("https://example.com/", {
        fetchImpl,
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/resolve/);
  });

  it("rejects non-HTML answers, error statuses, network failures, and bare pages", async () => {
    const routes = {
      "https://example.com/file.pdf": () =>
        new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }),
      "https://example.com/missing": () => new Response("gone", { status: 404 }),
      "https://example.com/bare": () => html("<html><body>nothing</body></html>"),
    };
    const lookup = publicLookup;
    await expect(
      fetchLinkPreview("https://example.com/file.pdf", { fetchImpl: fakeFetch(routes), lookup }),
    ).rejects.toThrow(/not a web page/);
    await expect(
      fetchLinkPreview("https://example.com/missing", { fetchImpl: fakeFetch(routes), lookup }),
    ).rejects.toThrow(/404/);
    await expect(
      fetchLinkPreview("https://example.com/bare", { fetchImpl: fakeFetch(routes), lookup }),
    ).rejects.toThrow(/no preview/);
    await expect(
      fetchLinkPreview("https://example.com/down", {
        fetchImpl: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
        lookup,
      }),
    ).rejects.toThrow(/reach/);
    await expect(fetchLinkPreview("ftp://example.com/", { lookup })).rejects.toThrow(/Not a link/);
  });

  it("stops reading a page after half a megabyte", async () => {
    const head = `<html><head><meta property="og:title" content="Big page"></head><body>`;
    const filler = "x".repeat(1024);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode(head));
        else if (pulls > 5_000) controller.close();
        else controller.enqueue(new TextEncoder().encode(filler));
      },
    });
    const data = await fetchLinkPreview("https://example.com/big", {
      fetchImpl: fakeFetch({
        "https://example.com/big": () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
      }),
      lookup: publicLookup,
    });
    expect(data.title).toBe("Big page");
    expect(pulls).toBeLessThan(1_000);
  });

  it("decodes the charset the page declares", async () => {
    const latin = new Uint8Array([...new TextEncoder().encode('<title>Caf'), 0xe9, ...new TextEncoder().encode("</title>")]);
    const data = await fetchLinkPreview("https://example.com/latin", {
      fetchImpl: fakeFetch({
        "https://example.com/latin": () =>
          new Response(latin, {
            status: 200,
            headers: { "content-type": "text/html; charset=iso-8859-1" },
          }),
      }),
      lookup: publicLookup,
    });
    expect(data.title).toBe("Café");
  });
});
