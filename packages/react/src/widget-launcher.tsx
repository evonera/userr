"use client";

import { useEffect, useRef } from "react";
import { init, type FeedbackWidget, type WidgetConfig } from "@userr/widget";

/** Mounts the zero-dependency launcher without moving its DOM into React.
 * The widget remains isolated in a closed Shadow DOM and is destroyed on
 * unmount, making this safe across client-side route transitions. */
export function WidgetLauncher({ config }: { config: WidgetConfig }) {
  const widget = useRef<FeedbackWidget | null>(null);
  useEffect(() => {
    widget.current = init(config);
    return () => { widget.current?.destroy(); widget.current = null; };
  // Config is deliberately captured at mount: changing an inline object on a
  // normal parent render must not reset a user who has opened the launcher.
  // Hosts that need a new policy should unmount/remount explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
