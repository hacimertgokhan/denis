"use client";

import { useRef, useState } from "react";
import { DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SectionRow } from "@/components/app/page-primitives";

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
          <div className="grid gap-3 rounded-lg border p-4">
            <div className="text-[13.5px] font-medium">Restore from a backup</div>
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <div className="grid gap-1.5">
                <Label htmlFor="bk-file" className="text-[12px]">
                  Backup file
                </Label>
                <input
                  id="bk-file"
                  ref={input}
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="file:bg-muted file:text-foreground text-[13px] file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-[13px]"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[12px]">Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">Merge into existing data</SelectItem>
                    <SelectItem value="replace">Replace everything</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-muted-foreground text-[12.5px] leading-relaxed">
              Merge writes the keys and rows of the backup on top of what is there (same keys are overwritten, tables are created when missing). Replace empties
              the database first. Quotas apply: a backup larger than the plan stops at the limit.
            </p>
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
                  {report.keys.skipped.length ? `, ${report.keys.skipped.length} skipped (line breaks or flags in the value)` : ""}
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
