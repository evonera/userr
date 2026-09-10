import { createContext, useContext, type CSSProperties, type PropsWithChildren } from "react";

export interface FeedbackTheme {
  accent?: string;
  surface?: string;
  text?: string;
  radius?: string;
}

const FeedbackThemeContext = createContext<FeedbackTheme>({});

export function FeedbackProvider({ theme = {}, children }: PropsWithChildren<{ theme?: FeedbackTheme }>) {
  const style = {
    "--lf-accent": theme.accent ?? "#4f46e5",
    "--lf-surface": theme.surface ?? "#ffffff",
    "--lf-text": theme.text ?? "#111827",
    "--lf-radius": theme.radius ?? "0.75rem",
  } as CSSProperties;
  return <FeedbackThemeContext.Provider value={theme}><section style={style}>{children}</section></FeedbackThemeContext.Provider>;
}

export const useFeedbackTheme = () => useContext(FeedbackThemeContext);
