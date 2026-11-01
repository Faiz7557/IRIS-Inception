// Light is the default; "dark" is a per-device choice made in Pengaturan. Silent mode forces dark via `.silent`.
export const THEME_KEY = "j112.theme";
export type Theme = "light" | "dark";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(v: Theme) {
  try {
    localStorage.setItem(THEME_KEY, v);
  } catch {
    /* storage blocked: still switch for this visit */
  }
  if (v === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}
