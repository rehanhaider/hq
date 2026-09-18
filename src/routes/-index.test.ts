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
    expect(nasr).toMatch(/to="\/nasr"/);
    expect(nasr).toMatch(/Open Nasr tracker/);
    expect(nasr).toContain(footer);
    expect(work).toContain(footer);
    expect(work).toMatch(/Open GitHub work/);
  });

  it("logs the next unlogged prayer as on time from the card", () => {
    expect(source).toMatch(/const nextPrayer = prayers\.find/);
    expect(nasr).toMatch(/`Log \$\{nextPrayer\[1\]\}`/);
    expect(nasr).toMatch(/date: nasr\.today,[\s\S]*key: nextPrayer\[0\]/);
    expect(nasr).toMatch(/!nextPrayer \|\| logPrayer\.isPending/);
    expect(nasr).toMatch(/The prayer could not be saved/);
  });

  it("keeps the button stable while the card updates optimistically", () => {
    expect(source).toMatch(/onMutate: async \(\{ key \}\)/);
    expect(source).toMatch(
      /day: \{ \.\.\.current\.nasr\.day, \[key\]: "ontime" \}/,
    );
    expect(source).toMatch(/onError: \(_error, _variables, context\)/);
    expect(nasr).toMatch(/className="w-16"/);
    expect(nasr).not.toMatch(/Logging…/);
    expect(nasr).not.toMatch(/size="sm"/);
  });
});
