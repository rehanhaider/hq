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

  it("logs on time in one click and offers qada from the menu", () => {
    expect(source).toMatch(/const nextPrayer = prayers\.find/);
    expect(nasr).toMatch(/Log \$\{nextPrayer\[1\]\} as on time/);
    expect(nasr).toMatch(/Choose how to log \$\{nextPrayer\[1\]\}/);
    expect(nasr).toMatch(/<MenuItem[\s\S]*status: "ontime"[\s\S]*On time/);
    expect(nasr).toMatch(/<MenuItem[\s\S]*status: "qada"[\s\S]*Qada/);
    expect(nasr).toMatch(/!nextPrayer \|\| logPrayer\.isPending/);
    expect(nasr).toMatch(/The prayer could not be saved/);
    expect(nasr).toMatch(/\{nextPrayer \? "Log" : "Done"\}/);
    expect(source).toMatch(/data: \{ date, \[key\]: status \}/);
  });

  it("keeps the button stable while the card updates optimistically", () => {
    expect(source).toMatch(/onMutate: async \(\{ key, status \}\)/);
    expect(source).toMatch(/const day = \{ \.\.\.nasr\.day, \[key\]: status \}/);
    expect(source).toMatch(/onError: \(_error, _variables, context\)/);
    expect(nasr).toMatch(/className="w-16 rounded-r-none"/);
    expect(nasr).not.toMatch(/Logging…/);
    expect(nasr).not.toMatch(/size="sm"/);
  });

  it("joins the split button halves without a seam", () => {
    expect(nasr).toMatch(
      /rounded-l-none border-l border-primary-foreground\/20 -ml-px max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11/,
    );
  });
});
