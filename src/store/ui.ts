import { create } from "zustand";

type Theme = "light" | "dark";

/** The colours the browser paints its own chrome with, per theme. */
const THEME_COLOR: Record<Theme, string> = {
  dark: "#131311",
  light: "#faf9f6",
};

/**
 * Puts the theme on the document. The attribute drives the stylesheet,
 * `color-scheme` drives form controls and scrollbars, and the meta colour
 * drives the browser's own chrome, so all three move together.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
}

export const useUI = create<{
  theme: Theme;
  hydrate: () => void;
  toggleTheme: () => void;
}>((set, get) => ({
  // Dark is HQ's default. Only a stored preference moves it to light, which
  // the document already reflects by the time this store hydrates.
  theme: "dark",
  hydrate: () =>
    set({
      theme:
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
    }),
  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try {
      localStorage.setItem("hq:theme", theme);
    } catch {
      /* The current session still changes theme. */
    }
    set({ theme });
  },
}));
