import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellPath = fileURLToPath(new URL("./Shell.tsx", import.meta.url));
const source = readFileSync(shellPath, "utf8");

describe("Shell sidebar expansion", () => {
  it("does not expand on hover or focus peek", () => {
    expect(source).not.toMatch(/onMouseEnter/);
    expect(source).not.toMatch(/onMouseLeave/);
    expect(source).not.toMatch(/onFocusCapture/);
    expect(source).not.toMatch(/onBlurCapture/);
    expect(source).not.toMatch(/setPreview/);
  });

  it("derives expanded state from the explicit toggle only", () => {
    expect(source).toMatch(/const \[sidebarOpen, setSidebarOpen\]/);
    expect(source).toMatch(/const expanded = sidebarOpen/);
    expect(source).toMatch(/localStorage\.getItem\("hq:sidebar"\)/);
    expect(source).toMatch(/localStorage\.setItem\("hq:sidebar"/);
  });

  it("keeps explicit expand/collapse controls", () => {
    expect(source).toMatch(/Expand navigation/);
    expect(source).toMatch(/Collapse navigation/);
    expect(source).toMatch(/aria-expanded=\{sidebarOpen\}/);
    expect(source).toMatch(/onClick=\{toggleSidebar\}/);
  });
});
