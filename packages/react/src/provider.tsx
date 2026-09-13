"use client";

import {
  createContext,
  useContext,
  type CSSProperties,
  type PropsWithChildren,
} from "react";

import { defaultMessages, type FeedbackMessages } from "./messages.js";

export interface FeedbackTheme {
  accent?: string;
  surface?: string;
  text?: string;
  muted?: string;
  border?: string;
  radius?: string;
}

interface FeedbackContextValue {
  theme: FeedbackTheme;
  messages: FeedbackMessages;
}

const FeedbackContext = createContext<FeedbackContextValue>({
  theme: {},
  messages: defaultMessages,
});

export interface FeedbackProviderProps {
  theme?: FeedbackTheme;
  messages?: Partial<FeedbackMessages>;
}

export function FeedbackProvider({
  theme = {},
  messages = {},
  children,
}: PropsWithChildren<FeedbackProviderProps>) {
  const style = {
    "--userr-accent": theme.accent ?? "#4f46e5",
    "--userr-surface": theme.surface ?? "#ffffff",
    "--userr-text": theme.text ?? "#111827",
    "--userr-muted": theme.muted ?? "#6b7280",
    "--userr-border": theme.border ?? "#e5e7eb",
    "--userr-radius": theme.radius ?? "0.75rem",
  } as CSSProperties;
  const value: FeedbackContextValue = {
    theme,
    messages: { ...defaultMessages, ...messages },
  };
  return (
    <FeedbackContext.Provider value={value}>
      <section style={style}>{children}</section>
    </FeedbackContext.Provider>
  );
}

export const useFeedbackTheme = () =>
  useContext(FeedbackContext).theme;

export const useFeedbackMessages = () =>
  useContext(FeedbackContext).messages;
