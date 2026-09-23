"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  confirmText,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Omit when the dialog is controlled through open/onOpenChange. */
  trigger?: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  /** When set, the user must type this text to enable the button. */
  confirmText?: string;
  onConfirm: () => Promise<void> | void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (o: boolean) => {
    setUncontrolledOpen(o);
    onOpenChange?.(o);
  };
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !confirmText || typed === confirmText;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText && (
          <div className="grid gap-2 text-sm">
            <span className="text-muted-foreground">
              Type <span className="text-foreground font-mono font-medium">{confirmText}</span> to confirm
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2Icon className="animate-spin" />} {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
