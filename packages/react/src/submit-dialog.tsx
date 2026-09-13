"use client";

import * as Dialog from "@radix-ui/react-dialog";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import { FeedbackForm, type FeedbackFormProps } from "./feedback-form.js";

export interface SubmitDialogProps extends FeedbackFormProps {
  triggerLabel?: string;
  title?: string;
  className?: string;
}

export function SubmitDialog({
  triggerLabel,
  title,
  className,
  ...formProps
}: SubmitDialogProps) {
  const messages = useFeedbackMessages();
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className={cn(
          "rounded-md px-4 py-2 text-sm font-semibold text-white",
          className,
        )}
        style={{ background: "var(--userr-accent)" }}
      >
        {triggerLabel ?? messages.boardSubmitIdea}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--userr-radius)] border p-6"
          style={{
            background: "var(--userr-surface)",
            color: "var(--userr-text)",
            borderColor: "var(--userr-border)",
          }}
        >
          <Dialog.Title className="mb-4 text-lg font-bold">
            {title ?? messages.boardSubmitIdea}
          </Dialog.Title>
          <FeedbackForm {...formProps} />
          <Dialog.Close
            aria-label="Close"
            className="absolute top-3 right-3 rounded-md px-2 py-1 text-sm"
            style={{ color: "var(--userr-muted)" }}
          >
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
