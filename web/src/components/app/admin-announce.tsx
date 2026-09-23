"use client";

import { useState } from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { apiFetch } from "@/lib/client-api";

/** Compose, look at it, send it to yourself, then to everyone who asked for updates. */
export function AdminAnnounce({ recipients, mailConfigured, adminEmail }: { recipients: number; mailConfigured: boolean; adminEmail: string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "test" | "send" | null>(null);

  async function act(action: "preview" | "test" | "send") {
    setBusy(action);
    try {
      const r = await apiFetch<{ html?: string; sent?: number; failed?: number }>("/api/admin/announcements", {
        method: "POST",
        body: JSON.stringify({ subject, body, action }),
      });
      if (action === "preview") setHtml(r.html ?? "");
      if (action === "test") toast.success(`Test message sent to ${adminEmail}`);
      if (action === "send") toast.success(`Sent to ${r.sent} recipients${r.failed ? `, ${r.failed} failed` : ""}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ready = subject.trim().length >= 3 && body.trim().length >= 20;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
      <div className="grid gap-4">
        {!mailConfigured && (
          <p className="rounded-md border px-3 py-2 text-[13px]">
            No mail provider is configured (RESEND_API_KEY or SMTP_URL). Messages are written to the server log instead of being delivered.
          </p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="an-subject">Subject</Label>
          <Input id="an-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Denis 0.7: what changed" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="an-body">Message</Label>
          <Textarea
            id="an-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            maxLength={20000}
            placeholder={
              "Plain text. Blank lines separate paragraphs; a line that is only a link becomes a button-less link.\n\nhttps://github.com/hacimertgokhan/denis/blob/master/CHANGELOG.md"
            }
            className="font-mono text-[13px]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!ready || busy !== null} onClick={() => void act("preview")}>
            {busy === "preview" ? <Loader2Icon className="animate-spin" /> : null} Preview
          </Button>
          <Button variant="outline" size="sm" disabled={!ready || busy !== null} onClick={() => void act("test")}>
            {busy === "test" ? <Loader2Icon className="animate-spin" /> : null} Send me a test
          </Button>
          <ConfirmDialog
            title={`Send to ${recipients} recipients?`}
            description="Every account that opted in to product updates, confirmed its address and is not suspended gets this message with its own unsubscribe link. This cannot be recalled."
            confirmLabel="Send announcement"
            confirmText="send"
            onConfirm={() => act("send")}
            trigger={
              <Button size="sm" disabled={!ready || busy !== null || recipients === 0}>
                {busy === "send" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Send to {recipients}
              </Button>
            }
          />
        </div>
        <p className="text-muted-foreground text-[12.5px] leading-relaxed">
          Recipients are the {recipients} accounts that opted in. Codes and password resets are separate transactional messages and are not affected by the
          opt-in.
        </p>
      </div>
      <div className="bg-card overflow-hidden rounded-lg border">
        <div className="text-muted-foreground border-b px-4 py-2 text-[12.5px]">Preview</div>
        {html ? (
          <iframe title="Announcement preview" srcDoc={html} sandbox="" className="h-[36rem] w-full bg-[#f4f4f4]" />
        ) : (
          <div className="text-muted-foreground flex h-[36rem] items-center justify-center text-[13.5px]">Write the message and press Preview.</div>
        )}
      </div>
    </div>
  );
}
