"use client";

import { useRef, useState } from "react";
import { DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SectionRow } from "@/components/app/page-primitives";
import { cn } from "@/lib/utils";

type Report = {
  keys: { restored: number; skipped: string[] };
  tables: { name: string; rows: number; skipped: number; error?: string }[];
};

/**
 * Download the database as a zip; owners and admins can also restore one.
 * Restoring is a plain multipart upload so it works from curl as well.
 */
export function BackupPanel({ databaseId, canRestore }: { databaseId: string; canRestore: boolean }) {
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  async function restore() {
    if (!file) return;
    setBusy(true);
    setReport(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      const res = await fetch(`/api/v1/databases/${databaseId}/backup`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setReport(json.report);
      const rows = (json.report as Report).tables.reduce((n, t) => n + t.rows, 0);
      toast.success(`Restored ${json.report.keys.restored} keys and ${rows} rows`);
      setFile(null);
      if (input.current) input.current.value = "";
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      title="Backups"
      description="One zip with every key and every table as JSON (manifest.json, keys.json, tables/<name>.json). Restore it here, into another database, or read it with any tool."
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/v1/databases/${databaseId}/backup`} download>
              <DownloadIcon /> Download backup (.zip)
            </a>
          </Button>
        </div>

        {canRestore && (
          <div className="grid gap-4 rounded-lg border p-4">
            <div>
              <div className="text-[13.5px] font-medium">Restore from a backup</div>
              <p className="text-muted-foreground mt-1 text-[12.5px] leading-relaxed">
                Merge writes the backup on top of what is there (same keys are overwritten, tables are created when missing). Replace empties the database
                first. Quotas apply.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px]">Backup file</Label>
              <label className="bg-background hover:bg-muted/40 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-[13.5px] transition-colors">
                <UploadIcon className="text-muted-foreground size-4 shrink-0" />
                <span className={file ? "truncate" : "text-muted-foreground truncate"}>
                  {file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "Choose a .zip backup"}
                </span>
                <input ref={input} type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px]">Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["merge", "replace"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-[13px] transition-colors",
                      mode === m ? "border-foreground bg-foreground text-background" : "hover:bg-muted/40",
                    )}
                  >
                    <span className="block font-medium capitalize">{m}</span>
                    <span className={cn("block text-[12px]", mode === m ? "text-background/70" : "text-muted-foreground")}>
                      {m === "merge" ? "keep what is there" : "empty the database first"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <ConfirmDialog
                title={mode === "replace" ? "Replace everything with this backup?" : "Merge this backup?"}
                description={
                  mode === "replace"
                    ? "Every current key and table is deleted before the backup is written. This cannot be undone; download a backup first if in doubt."
                    : "Keys in the backup overwrite keys with the same name; rows are appended to their tables."
                }
                confirmLabel={mode === "replace" ? "Replace and restore" : "Merge"}
                confirmText={mode === "replace" ? "replace" : undefined}
                onConfirm={restore}
                trigger={
                  <Button size="sm" variant={mode === "replace" ? "destructive" : "default"} disabled={!file || busy}>
                    {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Restore
                  </Button>
                }
              />
            </div>
            {report && (
              <div className="text-muted-foreground grid gap-1 border-t pt-3 text-[12.5px]">
                <div>
                  Keys: {report.keys.restored} restored
                  {report.keys.skipped.length ? `, ${report.keys.skipped.length} skipped (line breaks, flags or size)` : ""}
                </div>
                {report.tables.map((t) => (
                  <div key={t.name}>
                    Table <span className="font-mono">{t.name}</span>: {t.rows} rows{t.skipped ? `, ${t.skipped} skipped` : ""}
                    {t.error ? ` — ${t.error}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SectionRow>
  );
}
