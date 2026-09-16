import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createReactBlockSpec } from "@blocknote/react";
import { tweetStatusId, tweetStatusUrl } from "@/lib/tweet";
import { tweetEmbedQuery } from "@/queries/tweet";
import { useUI } from "@/store/ui";

type TweetWidgets = {
  ready: (callback: (twttr: TweetWidgets) => void) => void;
  widgets: {
    createTweet: (
      id: string,
      element: HTMLElement,
      options?: {
        align?: "center" | "left" | "right";
        conversation?: "all" | "none";
        dnt?: boolean;
        theme?: "dark" | "light";
      },
    ) => Promise<HTMLElement | undefined>;
    /** Upgrades cached oEmbed blockquotes to full widgets in place. */
    load: (element?: HTMLElement) => Promise<unknown>;
  };
};

const WIDGETS_SRC = "https://platform.twitter.com/widgets.js";
const WIDGETS_WAIT_MS = 10_000;

let widgetsReady: Promise<TweetWidgets> | undefined;

function twitterWidgets(): TweetWidgets | undefined {
  const twttr = (window as Window & { twttr?: TweetWidgets }).twttr;
  return twttr?.widgets ? twttr : undefined;
}

function loadTwitterWidgets(): Promise<TweetWidgets> {
  const existing = twitterWidgets();
  if (existing) return Promise.resolve(existing);
  if (widgetsReady) return widgetsReady;
  widgetsReady = new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      widgetsReady = undefined;
      reject(error);
    };
    const finish = () => {
      const api = twitterWidgets();
      if (api) {
        resolve(api);
        return;
      }
      const pending = (window as Window & { twttr?: TweetWidgets }).twttr;
      if (pending?.ready) {
        pending.ready((twttr) => resolve(twttr));
        return;
      }
      fail(new Error("Twitter widgets did not initialize."));
    };
    const found = document.getElementById("twitter-wjs");
    if (found instanceof HTMLScriptElement) {
      if (twitterWidgets()) finish();
      else {
        found.addEventListener("load", finish);
        found.addEventListener("error", () =>
          fail(new Error("Twitter widgets failed to load.")),
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.id = "twitter-wjs";
    script.src = WIDGETS_SRC;
    script.async = true;
    script.addEventListener("load", finish);
    script.addEventListener("error", () =>
      fail(new Error("Twitter widgets failed to load.")),
    );
    document.head.appendChild(script);
  });
  return widgetsReady;
}

function TweetFallback({ url }: { url: string }) {
  return (
    <a
      href={url}
      className="text-primary underline"
      target="_blank"
      rel="noreferrer"
      data-testid="tweet-embed-fallback"
    >
      {url}
    </a>
  );
}

function TweetEmbed({ url }: { url: string }) {
  const theme = useUI((state) => state.theme);
  const cacheHost = useRef<HTMLDivElement>(null);
  const legacyHost = useRef<HTMLDivElement>(null);
  const [legacy, setLegacy] = useState<"idle" | "loading" | "failed">("idle");
  const id = tweetStatusId(url);
  const href = tweetStatusUrl(url) ?? url;
  const embed = useQuery(tweetEmbedQuery(id ?? "", theme));
  const cached = id ? embed.data : undefined;
  const cachedHtml = cached?.html;

  // Upgrade the cached HTML to the full widget in place. Depend on the
  // HTML string so a background refetch with the same markup does not
  // tear down an iframe that already painted. The text stays readable if
  // the widget script fails.
  useEffect(() => {
    if (!cachedHtml || !cacheHost.current) return;
    let cancelled = false;
    const host = cacheHost.current;
    void loadTwitterWidgets()
      .then((twttr) => {
        if (!cancelled) return twttr.widgets.load(host);
      })
      .catch(() => {
        /* The cached text stays readable. */
      });
    return () => {
      cancelled = true;
    };
  }, [cachedHtml]);

  // Last resort: no cached or fresh HTML (X unreachable, tweet deleted).
  // This is the old path, kept so a failed fetch still shows the tweet.
  useEffect(() => {
    const element = legacyHost.current;
    if (!id || cached || !embed.isError || !element) return;
    let cancelled = false;
    let timer = 0;
    setLegacy("loading");
    element.replaceChildren();
    const wait = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error("Twitter widgets timed out.")),
        WIDGETS_WAIT_MS,
      );
    });
    void Promise.race([loadTwitterWidgets(), wait])
      .then((twttr) => {
        if (cancelled || !legacyHost.current) return undefined;
        return twttr.widgets.createTweet(id, legacyHost.current, {
          conversation: "none",
          dnt: true,
          theme,
        });
      })
      .then((widget) => {
        if (cancelled) {
          widget?.remove();
          return;
        }
        setLegacy(widget ? "idle" : "failed");
      })
      .catch(() => {
        if (!cancelled) setLegacy("failed");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, cached, embed.isError, theme]);

  if (!id) return <TweetFallback url={href} />;

  if (cached) {
    return (
      <div
        className="tweet-embed"
        contentEditable={false}
        data-testid="tweet-embed"
      >
        {/* The HTML is X's oEmbed blockquote, fetched server-side and
            script-stripped. The widget script upgrades it in place. */}
        <div
          ref={cacheHost}
          dangerouslySetInnerHTML={{ __html: cached.html }}
        />
      </div>
    );
  }

  if (embed.isPending) {
    return (
      <div
        className="tweet-embed"
        contentEditable={false}
        data-testid="tweet-embed"
      >
        <div
          className="flex flex-col gap-2"
          role="status"
          aria-label="Loading tweet"
        >
          <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="tweet-embed" contentEditable={false} data-testid="tweet-embed">
      {legacy === "failed" ? (
        <TweetFallback url={href} />
      ) : (
        <div ref={legacyHost} aria-label="Loading tweet" role="status" />
      )}
    </div>
  );
}

function tweetFromElement(element: HTMLElement) {
  if (element.getAttribute("data-content-type") === "tweet") {
    const url = tweetStatusUrl(element.getAttribute("data-url") ?? "");
    return url ? { url } : undefined;
  }
  if (element.tagName !== "BLOCKQUOTE" || !element.classList.contains("twitter-tweet"))
    return undefined;
  for (const anchor of element.querySelectorAll("a")) {
    const url = tweetStatusUrl(anchor.href);
    if (url) return { url };
  }
  return undefined;
}

export const tweetBlock = createReactBlockSpec(
  {
    type: "tweet",
    propSchema: {
      url: { default: "" },
      textAlignment: {
        default: "left" as const,
        values: ["left", "center", "right", "justify"] as const,
      },
    },
    content: "none",
  },
  {
    parse: tweetFromElement,
    runsBefore: ["quote"],
    render: ({ block }) => <TweetEmbed url={block.props.url} />,
    toExternalHTML: ({ block }) => (
      <blockquote className="twitter-tweet">
        <a href={block.props.url}>{block.props.url}</a>
      </blockquote>
    ),
  },
);
