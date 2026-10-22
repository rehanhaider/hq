import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const homePath = fileURLToPath(new URL("./index.tsx", import.meta.url));
const source = readFileSync(homePath, "utf8");
const nasr = source.slice(
  source.indexOf('aria-labelledby="nasr-heading"'),
  source.indexOf("<WaitingCard"),
);
const work = source.slice(source.indexOf("function WaitingCard"));
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

describe("Home Waiting on you card", () => {
  it("renders a saved feed with the page and never waits on a sweep", () => {
    expect(source).toMatch(/seedOpenWork\(context\.queryClient\)/);
    expect(source).toMatch(/const saved = await getCachedOpenWorkSummary\(\)/);
    expect(source).toMatch(
      /if \(saved\) queryClient\.setQueryData\(openWorkSummaryQuery\.queryKey, saved\)/,
    );
    expect(source).not.toMatch(/getOpenWork(Summary)?\(/);
    expect(source).not.toMatch(/openWorkQuery/);
  });

  it("still shows its own skeleton when there is no saved feed", () => {
    expect(work).toMatch(/useQuery\(openWorkSummaryQuery\)/);
    expect(work).toMatch(/aria-label="Loading open work"/);
  });
});

describe("Home Waiting on you card list", () => {
  it("follows the Overview's order and says so, replacing the oldest-first list of #10", () => {
    expect(work).toMatch(/data\.waiting\.map/);
    expect(work).toMatch(/Review first, then assigned, quietest first/);
    expect(work).toMatch(/aria-labelledby="waiting-order"/);
    expect(work).not.toMatch(/Oldest open/);
    expect(work).not.toMatch(/\.oldest\b/);
  });

  it("shows the real GitHub error rather than a generic line", () => {
    expect(work).toMatch(/role="alert"/);
    expect(work).toMatch(/work\.error\?\.message \|\| data\?\.error \|\| "Could not read GitHub\."/);
    expect(work).not.toMatch(/Connect GitHub to see open work/);
    expect(work).not.toMatch(/Some of GitHub could not be read/);
  });

  it("gives the title its own line and keeps the full repository in the tooltip", () => {
    expect(work).toMatch(/title=\{item\.repo\}/);
    expect(work).toMatch(/\{repoName\(item\.repo\)\}/);
    expect(work).toMatch(/line-clamp-2 break-words">\s*\{item\.title\}/);
    expect(work).not.toMatch(/grid-cols-\[minmax\(0,8rem\)/);
  });
});

describe("Home status line", () => {
  it("keeps one heading and links each part to the card that holds it", () => {
    expect(source.match(/<h1\b/g)).toHaveLength(1);
    expect(source).toMatch(/hash=\{segment\.card\}/);
    for (const id of ["nasr", "waiting", "code", "flight"])
      expect(source).toContain(`id="${id}"`);
    expect(source).not.toMatch(/WORDS/);
  });
});

describe("Home practices", () => {
  it("reads the practices and istighfar out, with no control to log them", () => {
    expect(source).not.toMatch(/type="checkbox"/);
    expect(source).not.toMatch(/setNasrAdhkarItem/);
    expect(source.match(/useMutation\(/g)).toHaveLength(1);
    expect(nasr).not.toMatch(/istighfar_count:/);
    expect(nasr).toMatch(/search=\{\{ guide: practice\.key \}\}/);
  });

  it("opens a day on Today from each mark of the strip", () => {
    expect(nasr).toMatch(/search=\{\{ date: mark\.date \}\}/);
    expect(nasr).toMatch(/aria-label=\{markLabel\(mark\)\}/);
    expect(source).not.toMatch(/AdherenceRing|donutChart/);
  });
});
