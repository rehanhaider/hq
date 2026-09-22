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

const applyEmbedPlan = source.slice(
  source.indexOf("function applyEmbedPlan("),
  source.indexOf("const DefaultDropdownMenuTrigger"),
);

describe("embed plan", () => {
  it("decides placement once, before the selection is deleted", () => {
    // A second plan after the delete could say `ignore` and return false
    // having already mutated, and `handleTextInput` would then insert the
    // user's text at positions it resolved before that delete.
    expect(applyEmbedPlan.match(/\bplan\(/g)).toHaveLength(1);
    expect(applyEmbedPlan.indexOf("plan(text, cursor)")).toBeLessThan(
      applyEmbedPlan.indexOf("deleteSelection()"),
    );
    expect(applyEmbedPlan).not.toMatch(/pasteTarget\(block, true\)/);
  });

  it("reads emptiness from a selection that covers the whole textblock", () => {
    expect(source).toMatch(
      /cursor = pasteTarget\(block, selectionLeavesBlockEmpty\(editor\)\)/,
    );
    expect(source).toMatch(/\$from\.parentOffset === 0/);
    expect(source).toMatch(/\$to\.parentOffset === \$to\.parent\.content\.size/);
  });
});

describe("side menu + button", () => {
  it("replaces BlockNote's add-block button, which opens the block-type menu", () => {
    expect(source).toMatch(/sideMenu=\{false\}/);
    expect(source).toMatch(
      /<SideMenu \{\.\.\.props\}>\s*<AddLineButton \/>\s*<DragHandleButton \{\.\.\.props\} \/>\s*<\/SideMenu>/,
    );
    expect(source).not.toMatch(/\bAddBlockButton\b/);
  });

  it("inserts an empty paragraph above the hovered block, or below it with Alt held, and moves the caret there", () => {
    expect(addLine).toMatch(
      /editor\.insertBlocks\(\s*\[\{ type: "paragraph" \}\],\s*block,\s*event\.altKey \? "after" : "before",?\s*\)/,
    );
    expect(addLine).toMatch(/editor\.setTextCursorPosition\(inserted\)/);
  });

  it("keeps the side menu open when Alt is pressed so Alt+click can reach the button", () => {
    expect(source).toMatch(
      /const keepSideMenuOnAlt = \(event: KeyboardEvent\) => \{\s*if \(!editable\) return;\s*if \(event\.key !== "Alt"\) return;\s*if \(!host\.querySelector\("\.bn-side-menu"\)\) return;\s*event\.stopPropagation\(\);\s*\};[\s\S]*?window\.addEventListener\("keydown", keepSideMenuOnAlt, true\)/,
    );
  });

  it("never opens the suggestion menu or changes the hovered block", () => {
    expect(addLine).not.toMatch(/openSuggestionMenu|SuggestionMenu|updateBlock|replaceBlocks/);
  });
});
