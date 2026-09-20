import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./ContentBoard.tsx", import.meta.url)),
  "utf8",
);
const column = source.slice(source.indexOf("function Column("));

describe("board columns", () => {
  it("asks the same guard before the preview moves a card and before the drop commits", () => {
    const over = source.slice(
      source.indexOf("const onDragOver"),
      source.indexOf("const onDragEnd"),
    );
    const end = source.slice(
      source.indexOf("const onDragEnd"),
      source.indexOf("const commit ="),
    );
    expect(over).toMatch(/if \(!canDropOnColumn\(moving, group, propertyOf\(from\), propertyOf\(to\)\)\) return list;/);
    expect(end).toMatch(/!canDropOnColumn\(\s*activePage,\s*group,\s*propertyOf\(source\.current\),\s*propertyOf\(target\),?\s*\)/);
    // The refused drop leaves before anything is arranged, repositioned, or sent.
    const refusal = end.slice(end.indexOf("canDropOnColumn"));
    expect(refusal.slice(0, refusal.indexOf("const overPage"))).toMatch(
      /setLocal\(null\);\s*return;/,
    );
  });

  it("offers no New button on the column that collects the pages with no status", () => {
    expect(source).toMatch(
      /onAdd=\{\s*group === "status" && bucket\.id === null\s*\?\s*undefined\s*:\s*\(\) => void addCard\(bucket\)\s*\}/,
    );
    expect(column).toMatch(/\{onAdd && \(/);
  });
});
