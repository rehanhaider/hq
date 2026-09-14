import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { deenKeys } from "./deen";
import { contentKeys, invalidateContent } from "./content";

describe("invalidateContent", () => {
  it("marks home stale so a content write cannot leave the briefing on a pre-write summary", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(contentKeys.lists, []);
    client.setQueryData(deenKeys.home, { content: { total: 0 } });

    await invalidateContent(client);

    expect(client.getQueryState(contentKeys.lists)?.isInvalidated).toBe(true);
    expect(client.getQueryState(deenKeys.home)?.isInvalidated).toBe(true);
  });

  it("forwards a narrower content key without skipping home", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(contentKeys.properties, {});
    client.setQueryData(contentKeys.lists, []);
    client.setQueryData(deenKeys.home, { content: { total: 0 } });

    await invalidateContent(client, contentKeys.properties);

    expect(client.getQueryState(contentKeys.properties)?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(contentKeys.lists)?.isInvalidated).toBe(false);
    expect(client.getQueryState(deenKeys.home)?.isInvalidated).toBe(true);
  });
});
