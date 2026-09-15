import { useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { tweetStatusId, tweetStatusUrl } from "@/lib/tweet";
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
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const id = tweetStatusId(url);
  const href = tweetStatusUrl(url) ?? url;

  useEffect(() => {
    const element = host.current;
    if (!id || !element) {
      setStatus("failed");
      return;
    }
    let cancelled = false;
    let timer = 0;
    setStatus("loading");
    element.replaceChildren();
    const wait = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error("Twitter widgets timed out.")),
        WIDGETS_WAIT_MS,
      );
    });
    void Promise.race([loadTwitterWidgets(), wait])
      .then((twttr) => {
        if (cancelled || !host.current) return undefined;
        return twttr.widgets.createTweet(id, host.current, {
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
        setStatus(widget ? "ready" : "failed");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, theme]);

  if (!id) return <TweetFallback url={href} />;

  return (
    <div className="tweet-embed" contentEditable={false} data-testid="tweet-embed">
      {status === "loading" && (
        <p className="text-sm text-muted-foreground">Loading tweet</p>
      )}
      {status === "failed" && <TweetFallback url={href} />}
      <div ref={host} hidden={status === "failed"} />
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
