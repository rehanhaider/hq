import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const homePath = fileURLToPath(new URL("./index.tsx", import.meta.url));
const source = readFileSync(homePath, "utf8");
const nasr = source.slice(
  source.indexOf('aria-labelledby="nasr-heading"'),
  source.indexOf("<OpenWorkCard"),
);
const work = source.slice(source.indexOf("function OpenWorkCard"));
const footer = 'className="text-[0.8125rem] font-medium text-primary"';

describe("Home Nasr card footer", () => {
  it("shows Open Nasr tracker at the bottom, matching the GitHub work footer", () => {
    expect(nasr).toMatch(/to="\/deen"/);
    expect(nasr).toMatch(/Open Nasr tracker/);
    expect(nasr).toContain(footer);
    expect(work).toContain(footer);
    expect(work).toMatch(/Open GitHub work/);
  });

  it("is a text footer link, not a button", () => {
    expect(nasr).not.toMatch(/Log today/);
    expect(nasr).not.toMatch(/buttonVariants/);
  });
});
