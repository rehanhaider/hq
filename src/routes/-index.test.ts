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

  it("offers On time and Qada for the next unlogged prayer", () => {
    expect(source).toMatch(/const nextPrayer = prayers\.find/);
    expect(nasr).toMatch(/Log \$\{nextPrayer\[1\]\} as on time/);
    expect(nasr).toMatch(/Log \$\{nextPrayer\[1\]\} as qada/);
    expect(nasr).toMatch(/status: "ontime"/);
    expect(nasr).toMatch(/status: "qada"/);
    expect(nasr).toMatch(/!nextPrayer \|\| logPrayer\.isPending/);
    expect(nasr).toMatch(/The prayer could not be saved/);
    expect(nasr).not.toMatch(/"Done"/);
    expect(source).toMatch(/data: \{ date, \[key\]: status \}/);
  });

  it("keeps the button stable while the card updates optimistically", () => {
    expect(source).toMatch(/onMutate: async \(\{ key, status \}\)/);
    expect(source).toMatch(
      /day: \{ \.\.\.current\.nasr\.day, \[key\]: status \}/,
    );
    expect(source).toMatch(/onError: \(_error, _variables, context\)/);
    expect(nasr).not.toMatch(/Logging…/);
    expect(nasr).not.toMatch(/size="sm"/);
  });
});
