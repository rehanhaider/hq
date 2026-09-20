import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./ContentEditor.tsx", import.meta.url)),
  "utf8",
);
const addLine = source.slice(
  source.indexOf("function AddLineButton("),
  source.indexOf("function normalizedLink("),
);

describe("side menu + button", () => {
  it("replaces BlockNote's add-block button, which opens the block-type menu", () => {
    expect(source).toMatch(/sideMenu=\{false\}/);
    expect(source).toMatch(
      /<SideMenu \{\.\.\.props\}>\s*<AddLineButton \/>\s*<DragHandleButton \{\.\.\.props\} \/>\s*<\/SideMenu>/,
    );
    expect(source).not.toMatch(/\bAddBlockButton\b/);
  });

  it("inserts an empty paragraph after the hovered block and moves the caret there", () => {
    expect(addLine).toMatch(
      /editor\.insertBlocks\(\s*\[\{ type: "paragraph" \}\],\s*block,\s*"after",?\s*\)/,
    );
    expect(addLine).toMatch(/editor\.setTextCursorPosition\(inserted\)/);
  });

  it("never opens the suggestion menu or changes the hovered block", () => {
    expect(addLine).not.toMatch(/openSuggestionMenu|SuggestionMenu|updateBlock|replaceBlocks/);
  });
});
