import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalAddress,
  fetchLinkPreview,
  isPublicAddress,
  isPublicHostname,
  localInterfaceAddresses,
  nodeTransport,
  type TransportInit,
} from "./linkPreview";

const PAGE = `<html><head>
  <title>Doc title</title>
  <meta property="og:title" content="OG title">
  <meta property="og:description" content="A description">
  <meta property="og:site_name" content="Example">
  <meta property="og:image" content="https://example.com/og.png">
</head><body></body></html>`;

type Call = { url: string; init: TransportInit };

function fakeFetch(routes: Record<string, () => Response>, calls: Call[] = []) {
  return async (url: string, init: TransportInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("missing", { status: 404 });
    return route();
  };
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
      "::ffff:7f00:1",
      "::FFFF:A9FE:A9FE",
      "::ffff:0:7f00:1",
      "::7f00:1",
      "::127.0.0.1",
      "64:ff9b::7f00:1",
      "64:ff9b::10.0.0.1",
      "2002:7f00:1::1",
      "2002:c0a8:101::",
      "ff02::1",
      "not an ip",
    ])
      expect(isPublicAddress(address), address).toBe(false);
  });

  it("accepts public addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicAddress("::ffff:5db8:d822")).toBe(true);
    expect(isPublicAddress("64:ff9b::5db8:d822")).toBe(true);
    expect(isPublicAddress("2002:5db8:d822::1")).toBe(true);
  });
});

describe("canonicalAddress", () => {
  it("reduces every IPv4 embedding to the IPv4 and expands the rest", () => {
    for (const spelling of [
      "::ffff:203.0.113.5",
      "::ffff:cb00:7105",
      "::FFFF:CB00:7105",
      "::ffff:0:203.0.113.5",
      "::203.0.113.5",
      "64:ff9b::203.0.113.5",
      "2002:cb00:7105::1",
    ])
      expect(canonicalAddress(spelling), spelling).toBe("203.0.113.5");
    expect(canonicalAddress("2001:DB8::1")).toBe("2001:db8:0:0:0:0:0:1");
    expect(canonicalAddress("2001:db8:0:0:0:0:0:1")).toBe("2001:db8:0:0:0:0:0:1");
    expect(canonicalAddress("::1")).toBe("0:0:0:0:0:0:0:1");
    expect(canonicalAddress("::")).toBe("0:0:0:0:0:0:0:0");
    expect(canonicalAddress("93.184.216.34")).toBe("93.184.216.34");
    expect(canonicalAddress("example.com")).toBeNull();
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
      "[::ffff:7f00:1]",
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
      transport: fakeFetch({ "https://example.com/post": () => html(PAGE) }, calls),
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
    expect(calls[0]?.init.address).toBe("93.184.216.34");
    expect(calls[0]?.init.headers.accept).toContain("text/html");
  });

  it("follows redirects and links the card to the final URL", async () => {
    const calls: Call[] = [];
    const data = await fetchLinkPreview("http://example.com/old", {
      transport: fakeFetch(
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
        transport: fakeFetch({
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
      transport: fakeFetch({
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
      transport: fakeFetch({
        "https://example.com/": () => html(page),
        "https://example.com/oembed": () => new Response("nope", { status: 500 }),
      }),
      lookup: publicLookup,
    });
    expect(data.title).toBe("Only a title");
    expect(data.image).toBeNull();
  });

  it("pins each hop to the address that passed the check", async () => {
    const calls: Call[] = [];
    const answers: Record<string, string[]> = {
      "example.com": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
      "cdn.example.net": ["151.101.1.69"],
    };
    await fetchLinkPreview("https://example.com/hop", {
      transport: fakeFetch(
        {
          "https://example.com/hop": () =>
            new Response(null, { status: 302, headers: { location: "https://cdn.example.net/p" } }),
          "https://cdn.example.net/p": () => html(PAGE),
        },
        calls,
      ),
      lookup: async (host) => answers[host] ?? [],
    });
    expect(calls.map((call) => call.init.address)).toEqual(["93.184.216.34", "151.101.1.69"]);
    const literal: Call[] = [];
    await fetchLinkPreview("http://[2606:2800:220:1:248:1893:25c8:1946]/", {
      transport: fakeFetch(
        { "http://[2606:2800:220:1:248:1893:25c8:1946]/": () => html(PAGE) },
        literal,
      ),
      lookup: async () => {
        throw new Error("a literal is never looked up");
      },
    });
    expect(literal[0]?.init.address).toBe("2606:2800:220:1:248:1893:25c8:1946");
  });

  it("refuses private hosts, on the first URL and after a redirect", async () => {
    const calls: Call[] = [];
    const transport = fakeFetch(
      {
        "https://example.com/hop": () =>
          new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/" } }),
      },
      calls,
    );
    await expect(
      fetchLinkPreview("http://localhost:3000/", { transport, lookup: publicLookup }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("http://[::ffff:127.0.0.1]/", { transport, lookup: publicLookup }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("https://intranet.example/", {
        transport,
        lookup: async () => ["10.0.0.5"],
      }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("https://example.com/hop", { transport, lookup: publicLookup }),
    ).rejects.toThrow(/local/);
    expect(calls.map((call) => call.url)).toEqual(["https://example.com/hop"]);
  });

  it("refuses this machine's own addresses, public or not, as a literal or a resolved name", async () => {
    const calls: Call[] = [];
    const transport = fakeFetch({ "http://203.0.113.5:8080/": () => html(PAGE), "https://self.example/": () => html(PAGE) }, calls);
    const localAddresses = ["203.0.113.5", "2001:DB8::1"];
    for (const literal of ["[::ffff:203.0.113.5]", "[::ffff:cb00:7105]", "[2002:cb00:7105::1]", "[64:ff9b::cb00:7105]", "[2001:db8:0:0:0:0:0:1]"])
      await expect(
        fetchLinkPreview(`http://${literal}:8080/`, { transport, lookup: publicLookup, localAddresses }),
        literal,
      ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("https://self.example/", {
        transport,
        lookup: async () => ["::ffff:cb00:7105"],
        localAddresses,
      }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("http://203.0.113.5:8080/", { transport, lookup: publicLookup, localAddresses }),
    ).rejects.toThrow(/local/);
    await expect(
      fetchLinkPreview("https://self.example/", {
        transport,
        lookup: async () => ["93.184.216.34", "2001:db8::1"],
        localAddresses,
      }),
    ).rejects.toThrow(/local/);
    expect(calls).toEqual([]);
    await fetchLinkPreview("http://203.0.113.5:8080/", { transport, lookup: publicLookup, localAddresses: [] });
    expect(calls).toHaveLength(1);
    const own = localInterfaceAddresses();
    expect(own.has("127.0.0.1")).toBe(true);
    for (const address of own) expect(address).not.toMatch(/%/);
  });

  it("refuses a host with no addresses or a failed lookup", async () => {
    const transport = fakeFetch({ "https://example.com/": () => html(PAGE) });
    await expect(
      fetchLinkPreview("https://example.com/", { transport, lookup: async () => [] }),
    ).rejects.toThrow();
    await expect(
      fetchLinkPreview("https://example.com/", {
        transport,
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
      fetchLinkPreview("https://example.com/file.pdf", { transport: fakeFetch(routes), lookup }),
    ).rejects.toThrow(/not a web page/);
    await expect(
      fetchLinkPreview("https://example.com/missing", { transport: fakeFetch(routes), lookup }),
    ).rejects.toThrow(/404/);
    await expect(
      fetchLinkPreview("https://example.com/bare", { transport: fakeFetch(routes), lookup }),
    ).rejects.toThrow(/no preview/);
    await expect(
      fetchLinkPreview("https://example.com/down", {
        transport: async () => {
          throw new TypeError("fetch failed");
        },
        lookup,
      }),
    ).rejects.toThrow(/reach/);
    await expect(fetchLinkPreview("ftp://example.com/", { lookup })).rejects.toThrow(/Not a link/);
  });

  function endless(chunks: string[], filler = "x".repeat(1024)) {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        const next = chunks[pulls - 1];
        if (next !== undefined) controller.enqueue(new TextEncoder().encode(next));
        else if (pulls > 5_000) controller.close();
        else controller.enqueue(new TextEncoder().encode(filler));
      },
    });
    return { stream, pulls: () => pulls };
  }

  async function previewOf(stream: ReadableStream<Uint8Array>) {
    return fetchLinkPreview("https://example.com/big", {
      transport: fakeFetch({
        "https://example.com/big": () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
      }),
      lookup: publicLookup,
    });
  }

  it("stops reading once the head closes, even mid-chunk, and never past a megabyte", async () => {
    const closed = endless([`<html><head><meta property="og:title" content="Big page"></HEAD`, `>\n<body>`]);
    const data = await previewOf(closed.stream);
    expect(data.title).toBe("Big page");
    // The stream pulls one chunk ahead of the reader, so two chunks read is three pulled.
    expect(closed.pulls()).toBeLessThanOrEqual(3);

    const open = endless([`<html><head><meta property="og:title" content="Open head">`]);
    const data2 = await previewOf(open.stream);
    expect(data2.title).toBe("Open head");
    expect(open.pulls()).toBeGreaterThan(1_000);
    expect(open.pulls()).toBeLessThanOrEqual(1_030);
  });

  it("reads tags that sit behind hundreds of kilobytes of script", async () => {
    const script = `<script>${"y".repeat(700 * 1024)}</script>`;
    const late = endless([
      `<html><head>${script}<meta property="og:title" content="Late tags"></head><body>`,
    ]);
    const data = await previewOf(late.stream);
    expect(data.title).toBe("Late tags");
    expect(late.pulls()).toBeLessThanOrEqual(2);
  });

  it("decodes the charset the page declares", async () => {
    const latin = new Uint8Array([...new TextEncoder().encode('<title>Caf'), 0xe9, ...new TextEncoder().encode("</title>")]);
    const data = await fetchLinkPreview("https://example.com/latin", {
      transport: fakeFetch({
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

describe("nodeTransport", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  async function listen(handler: Parameters<typeof createServer>[1]) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    return address.port;
  }

  it("dials the pinned address, not the hostname, and answers as a Response", async () => {
    const seen: { host?: string; agent?: string }[] = [];
    const port = await listen((req, res) => {
      seen.push({ host: req.headers.host, agent: req.headers["user-agent"] });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-echo": "1" });
      res.end("<title>Pinned</title>");
    });
    const response = await nodeTransport(`http://pinned.invalid:${port}/page`, {
      headers: { accept: "text/html", "user-agent": "test-agent" },
      address: "127.0.0.1",
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-echo")).toBe("1");
    expect(await response.text()).toBe("<title>Pinned</title>");
    expect(seen).toEqual([{ host: `pinned.invalid:${port}`, agent: "test-agent" }]);
  });

  it("keeps redirects unfollowed and unwraps gzip bodies", async () => {
    const port = await listen((req, res) => {
      if (req.url === "/go") {
        res.writeHead(302, { location: "/zipped" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(gzipSync("<title>Zipped</title>"));
    });
    const init = {
      headers: {},
      address: "127.0.0.1",
      signal: AbortSignal.timeout(5_000),
    };
    const redirect = await nodeTransport(`http://pinned.invalid:${port}/go`, init);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/zipped");
    const zipped = await nodeTransport(`http://pinned.invalid:${port}/zipped`, init);
    expect(await zipped.text()).toBe("<title>Zipped</title>");
  });

  it("rejects when nothing listens at the pinned address", async () => {
    const port = await listen(() => undefined);
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
    await expect(
      nodeTransport(`http://pinned.invalid:${port}/`, {
        headers: {},
        address: "127.0.0.1",
        signal: AbortSignal.timeout(5_000),
      }),
    ).rejects.toThrow();
  });
});
