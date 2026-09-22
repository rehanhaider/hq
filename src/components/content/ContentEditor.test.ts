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
    // Both must be present, or `indexOf` returns -1 and the ordering below
    // passes on two absent strings.
    const planned = applyEmbedPlan.indexOf("plan(text, cursor)");
    const deleted = applyEmbedPlan.indexOf("deleteSelection()");
    expect(planned).toBeGreaterThanOrEqual(0);
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(planned).toBeLessThan(deleted);
    expect(applyEmbedPlan).not.toMatch(/pasteTarget\(block, true\)/);
  });

  it("reads emptiness from the selection's offsets, on both sides of a block boundary", () => {
    expect(source).toMatch(
      /cursor = pasteTarget\(block, selectionLeavesBlockEmpty\(editor\)\)/,
    );
    expect(source).toMatch(/\$from\.parentOffset === 0/);
    expect(source).toMatch(/\$to\.parentOffset === \$to\.parent\.content\.size/);
    // A selection that crosses blocks still gets judged on its offsets: the
    // delete merges what it crosses, so only the ends say what survives.
    expect(source).not.toMatch(/\$from\.parent !== \$to\.parent/);
    expect(source).toMatch(/if \(selection\.empty\) return null;/);
    // Select-all resolves both ends to the document, so the textblock guard
    // has to stand aside or the card never replaces the emptied block.
    expect(source).toMatch(
      /const spansDocument = \$from\.depth === 0 && \$to\.depth === 0;/,
    );
    expect(source).toMatch(/if \(!spansDocument && \(!\$from\.parent\.isTextblock/);
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
