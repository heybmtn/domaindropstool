import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { QueueState, ResearchJobDto } from "../../shared/api";
import { useToast } from "../components/Toast";
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatDateTime, formatMoney, formatNumber } from "../lib/format";
import { keys, useQueueState } from "../lib/queries";

const STATUS_TABS = ["pending", "processing", "completed", "failed"] as const;
const STATUS_TONES = { pending: "amber", processing: "blue", completed: "green", failed: "red" } as const;

export function QueuePage() {
  const client = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("pending");
  const queue = useQueueState(5_000);
  const jobs = useQuery({
    queryKey: ["jobs", tab],
    queryFn: () => api.get<{ items: ResearchJobDto[]; total: number }>(`/research/jobs?status=${tab}&limit=100`),
    refetchInterval: 5_000,
  });

  const action = useMutation({
    mutationFn: ({ path }: { path: string; label: string }) => api.post<unknown>(path),
    onSuccess: (_data, variables) => {
      toast(variables.label, "success");
      void client.invalidateQueries({ queryKey: keys.queue });
      void client.invalidateQueries({ queryKey: ["jobs"] });
      void client.invalidateQueries({ queryKey: ["domains"] });
    },
    onError: (error) => toast(errorText(error), "error"),
  });

  const q: QueueState | undefined = queue.data;
  return (
    <>
      <PageHeader
        title="Research Queue"
        description="Jobs are processed in the background every 2 minutes in small batches. Updates live."
        actions={
          q && (
            <>
              {q.paused ? (
                <Button variant="primary" onClick={() => action.mutate({ path: "/research/resume", label: "Queue resumed" })}>
                  Resume
                </Button>
              ) : (
                <Button onClick={() => action.mutate({ path: "/research/pause", label: "Queue paused" })}>Pause</Button>
              )}
              <Button disabled={q.counts.failed === 0} onClick={() => action.mutate({ path: "/research/retry-failed", label: "Failed jobs re-queued" })}>
                Retry failed
              </Button>
              <Button
                variant="ghost"
                disabled={q.counts.completed === 0}
                title="Removes completed job records only. Research metrics are kept."
                onClick={() => action.mutate({ path: "/research/clear-completed", label: "Completed jobs cleared (metrics kept)" })}
              >
                Clear completed
              </Button>
            </>
          )
        }
      />

      {queue.isError && <ErrorState message={errorText(queue.error)} onRetry={() => queue.refetch()} />}
      {q && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Pending" tone="amber" value={formatNumber(q.counts.pending)} />
            <StatCard label="Processing" tone="blue" value={formatNumber(q.counts.processing)} />
            <StatCard label="Completed" tone="green" value={formatNumber(q.counts.completed)} />
            <StatCard label="Failed" value={formatNumber(q.counts.failed)} />
          </div>
          <div className="mb-4 space-y-2">
            {q.paused && <Banner tone="warning">Queue paused. {q.pauseReason}</Banner>}
            {q.limitReached && (
              <Banner tone="warning">
                Daily limit reached: {formatNumber(q.usageToday.domains)} / {formatNumber(q.dailyLimit)} domains today. Jobs resume after midnight UTC or
                when the limit is raised in <Link className="underline" to="/settings">Settings</Link>.
              </Banner>
            )}
            {!q.providerConfigured && (
              <Banner tone="error">
                DataForSEO is not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as Worker secrets.
              </Banner>
            )}
            <p className="text-xs text-slate-500">
              Today: {formatNumber(q.usageToday.domains)} / {formatNumber(q.dailyLimit)} domains · {formatNumber(q.usageToday.providerCalls)} provider calls ·
              reported cost {formatMoney(q.usageToday.cost)}
            </p>
          </div>
        </>
      )}

      <Card>
        <div className="flex gap-1 border-b border-slate-100 px-3 pt-2" role="tablist">
          {STATUS_TABS.map((status) => (
            <button
              key={status}
              role="tab"
              aria-selected={tab === status}
              onClick={() => setTab(status)}
              className={`border-b-2 px-3 py-1.5 text-sm capitalize ${tab === status ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {status} {q && <span className="tabular text-xs text-slate-400">({formatNumber(q.counts[status])})</span>}
            </button>
          ))}
        </div>
        {jobs.isPending ? (
          <LoadingState />
        ) : jobs.isError ? (
          <ErrorState message={errorText(jobs.error)} onRetry={() => jobs.refetch()} />
        ) : jobs.data.items.length === 0 ? (
          <EmptyState title={`No ${tab} jobs.`}>Select domains on the dashboard and click “Research Selected”.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">Domain</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Priority</th>
                  <th className="px-3 py-2 text-right">Attempts</th>
                  <th className="px-3 py-2">Queued</th>
                  <th className="px-3 py-2">Finished / next attempt</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      <Link className="text-blue-800 hover:underline" to={`/domains/${job.domainId}`}>
                        {job.domain}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={STATUS_TONES[job.status]}>{job.status}</Badge>
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">{job.priority}</td>
                    <td className="tabular px-3 py-1.5 text-right">{job.attempts}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(job.createdAt)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(job.completedAt ?? job.nextAttemptAt)}</td>
                    <td className="max-w-80 truncate px-3 py-1.5 text-xs text-slate-600" title={job.errorMessage ?? ""}>
                      {job.errorMessage ?? ""}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {job.status === "failed" && (
                        <Button size="sm" onClick={() => action.mutate({ path: `/research/jobs/${job.id}/retry`, label: `Re-queued ${job.domain}` })}>
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
