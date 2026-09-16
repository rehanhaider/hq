import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellPath = fileURLToPath(new URL("./Shell.tsx", import.meta.url));
const source = readFileSync(shellPath, "utf8");
const rootPath = fileURLToPath(new URL("../routes/__root.tsx", import.meta.url));
const rootSource = readFileSync(rootPath, "utf8");
const cssPath = fileURLToPath(new URL("../styles/app.css", import.meta.url));
const cssSource = readFileSync(cssPath, "utf8");

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

describe("Shell sidebar first paint", () => {
  it("syncs stored state before paint, not in an effect after it", () => {
    expect(source).toMatch(/useIsomorphicLayoutEffect\(\(\) => \{/);
    expect(source).toMatch(/document\.documentElement\.dataset\.sidebar/);
    expect(source).not.toMatch(
      /useEffect\(\(\) => \{\s*try \{\s*setSidebarOpen\(localStorage/,
    );
  });

  it("keeps the pre-paint attribute in sync when toggled", () => {
    expect(source).toMatch(
      /document\.documentElement\.dataset\.sidebar = next \? "open" : "collapsed"/,
    );
  });

  it("keeps the attribute in sync even when storage throws", () => {
    const toggle = source.slice(source.indexOf("const toggleSidebar"));
    const datasetAt = toggle.indexOf(
      "document.documentElement.dataset.sidebar = next",
    );
    const tryAt = toggle.indexOf("try {");
    expect(datasetAt).toBeGreaterThan(-1);
    expect(tryAt).toBeGreaterThan(-1);
    expect(datasetAt).toBeLessThan(tryAt);
  });

  it("sets the sidebar attribute before first paint in __root", () => {
    expect(rootSource).toMatch(/data-sidebar="open"/);
    expect(rootSource).toMatch(
      /document\.documentElement\.dataset\.sidebar=localStorage\.getItem\('hq:sidebar'\)==='collapsed'\?'collapsed':'open'/,
    );
  });

  it("holds the collapsed geometry in the stylesheet until hydration", () => {
    expect(cssSource).toMatch(/html\[data-sidebar="collapsed"\]/);
    expect(cssSource).toMatch(
      /html\[data-sidebar="collapsed"\] aside\[aria-label="Sidebar"\]/,
    );
    expect(cssSource).toMatch(
      /html\[data-sidebar="collapsed"\] \.sidebar-offset/,
    );
    expect(cssSource).toMatch(
      /html\[data-sidebar="collapsed"\] \.sidebar-label/,
    );
    expect(source).toMatch(/sidebar-offset/);
    expect(source).toMatch(/sidebar-label/);
  });
});
