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

  it("cycles a prayer tile through on time, qada, missed, then clear", () => {
    expect(source).toMatch(/const nextPrayer = prayers\.find/);
    expect(source).toMatch(
      /status === null\s*\? "ontime"\s*: status === "ontime"\s*\? "qada"\s*: status === "qada"\s*\? "missed"\s*: null/,
    );
    expect(nasr).toMatch(/status: nextStatus\(status\)/);
    expect(nasr).toMatch(/aria-label=\{`\$\{label\}: \$\{state\}\. Change`\}/);
    expect(nasr).toMatch(/TILE_TONE\[status \?\? \(next \? "next" : "unset"\)\]/);
    expect(nasr).toMatch(/disabled=\{logPrayer\.isPending\}/);
    expect(nasr).toMatch(/Tap a prayer to cycle: on time, qada, missed, clear\./);
    expect(nasr).toMatch(/The prayer could not be saved/);
    expect(source).toMatch(/data: \{ date, \[key\]: status \}/);
  });

  it("gives every tile state a hover that steps up its own border", () => {
    for (const hover of [
      "hover:border-positive/60",
      "hover:border-warning/60",
      "hover:border-negative/60",
      "hover:border-primary\"",
      "hover:border-primary/40",
    ]) {
      expect(source).toContain(hover);
    }
    expect(source).not.toMatch(/translate-y|active:scale/);
  });

  it("lays the prayers out by the card's width, as rows until tiles fit", () => {
    expect(nasr).toContain('className="@container mt-4"');
    expect(nasr).toContain("@[22rem]:grid-cols-5");
    expect(nasr).toMatch(/min-h-11 w-full items-center[^"]*@\[22rem\]:flex-col/);
  });

  it("updates the tiles optimistically", () => {
    expect(source).toMatch(/onMutate: async \(\{ key, status \}\)/);
    expect(source).toMatch(/const day = \{ \.\.\.nasr\.day, \[key\]: status \}/);
    expect(source).toMatch(/onError: \(_error, _variables, context\)/);
    expect(nasr).not.toMatch(/Logging…/);
  });
});
