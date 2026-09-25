import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ImportBatchDto } from "../../shared/api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatDateTime, formatNumber } from "../lib/format";
import { keys, useSettings } from "../lib/queries";

const STATUS_TONES = { running: "blue", completed: "green", failed: "red", skipped: "slate" } as const;

interface ImportResult {
  outcome: "imported" | "unchanged";
  message: string;
  batch: ImportBatchDto | null;
}

function Detail({ batch }: { batch: ImportBatchDto }) {
  const rows: [string, React.ReactNode][] = [
    ["Status", <Badge tone={STATUS_TONES[batch.status]}>{batch.status}</Badge>],
    ["Source", batch.source],
    ["Source URL / file", batch.sourceUrl ?? "—"],
    ["Earliest drop date", batch.dropDate ?? "—"],
    ["Rows in file", formatNumber(batch.totalRecords)],
    ["New domains", formatNumber(batch.insertedRecords)],
    ["Already known / repeated", formatNumber(batch.duplicateRecords)],
    ["Invalid rows", formatNumber(batch.failedRecords)],
    ["Other TLDs (skipped)", formatNumber(batch.skippedRecords)],
    ["No longer listed", formatNumber(batch.removedRecords)],
    ["SHA-256", <code className="text-xs break-all">{batch.checksum ?? "—"}</code>],
    ["Archived file (R2)", batch.r2Key ?? "not archived"],
    ["Started", formatDateTime(batch.startedAt)],
    ["Completed", formatDateTime(batch.completedAt)],
  ];
  return (
    <>
      {batch.errorMessage && (
        <p className={`mb-3 rounded border px-3 py-2 ${batch.status === "failed" ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50"}`}>
          {batch.status === "failed" ? "Import failed. Previous data remains available. " : ""}
          {batch.errorMessage}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function ImportsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const settings = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<ImportBatchDto | null>(null);
  const history = useQuery({
    queryKey: keys.imports,
    queryFn: () => api.get<{ items: ImportBatchDto[] }>("/import/history"),
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === "running") ? 3_000 : false),
  });

  const onDone = (result: ImportResult) => {
    toast(result.message, result.outcome === "imported" ? "success" : "info");
    void client.invalidateQueries();
  };
  const onError = (error: unknown) => {
    toast(errorText(error), "error");
    void client.invalidateQueries({ queryKey: keys.imports });
  };
  const runImport = useMutation({
    mutationFn: (force: boolean) => api.post<ImportResult>(`/import${force ? "?force=true" : ""}`),
    onSuccess: onDone,
    onError,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload<ImportResult>(`/import/upload?filename=${encodeURIComponent(file.name)}`, file),
    onSuccess: onDone,
    onError,
  });
  const busy = runImport.isPending || upload.isPending;

  return (
    <>
      <PageHeader
        title="Imports"
        description={`Nominet drop list: ${settings.data?.nominet.dropListUrl ?? "…"} · checked hourly by cron`}
        actions={
          <>
            {busy && <Spinner />}
            <Button variant="primary" disabled={busy} onClick={() => runImport.mutate(false)}>
              Import latest now
            </Button>
            <Button disabled={busy} onClick={() => runImport.mutate(true)} title="Re-import even if this file was already imported">
              Force re-import
            </Button>
            <Button disabled={busy} onClick={() => fileInput.current?.click()}>
              Upload file…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.gz,text/csv,application/gzip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.target.value = "";
              }}
            />
          </>
        }
      />
      <Card>
        {history.isPending ? (
          <LoadingState />
        ) : history.isError ? (
          <ErrorState message={errorText(history.error)} onRetry={() => history.refetch()} />
        ) : history.data.items.length === 0 ? (
          <EmptyState title="No imports yet.">Click “Import latest now” or wait for the hourly cron.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Drop date</th>
                  <th className="px-3 py-2 text-right">Domains</th>
                  <th className="px-3 py-2 text-right">New</th>
                  <th className="px-3 py-2 text-right">Duplicates</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((batch) => (
                  <tr key={batch.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setSelected(batch)}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(batch.startedAt)}</td>
                    <td className="px-3 py-1.5">{batch.source}</td>
                    <td className="px-3 py-1.5">{batch.dropDate ?? "—"}</td>
                    <td className="tabular px-3 py-1.5 text-right">{formatNumber(batch.totalRecords)}</td>
                    <td className="tabular px-3 py-1.5 text-right">{formatNumber(batch.insertedRecords)}</td>
                    <td className="tabular px-3 py-1.5 text-right">{formatNumber(batch.duplicateRecords)}</td>
                    <td className="tabular px-3 py-1.5 text-right">{formatNumber(batch.failedRecords)}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={STATUS_TONES[batch.status]}>{batch.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={selected !== null} onClose={() => setSelected(null)} title={`Import #${selected?.id ?? ""}`} footer={<Button onClick={() => setSelected(null)}>Close</Button>}>
        {selected && <Detail batch={selected} />}
      </Modal>
    </>
  );
}
