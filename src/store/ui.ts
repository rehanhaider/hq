import { create } from "zustand";

type Theme = "light" | "dark";
export const useUI = create<{
  theme: Theme;
  hydrate: () => void;
  toggleTheme: () => void;
}>((set, get) => ({
  theme: "light",
  hydrate: () =>
    set({
      theme:
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    }),
  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem("hq:theme", theme);
    } catch {
      /* The current session still changes theme. */
    }
    set({ theme });
  },
}));
