import { useQuery } from "@tanstack/react-query";
import { filterToSearchParams, type DomainFilter } from "../../shared/filters";
import { api, errorText } from "../lib/api";
import { formatNumber } from "../lib/format";
import { useEnqueueResearch, useQueueState, useSettings } from "../lib/queries";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { Banner, Button, Spinner } from "./ui";

/**
 * Confirmation step before queuing research. Shows how many domains will be
 * queued against the remaining daily budget so costs are never a surprise.
 */
export function ResearchConfirmModal({
  open,
  onClose,
  domainIds,
  filter,
  onQueued,
  force = false,
}: {
  open: boolean;
  onClose: () => void;
  domainIds?: number[];
  filter?: DomainFilter;
  onQueued?: () => void;
  /** Re-research even if the domain was researched in the last 24 hours. */
  force?: boolean;
}) {
  const toast = useToast();
  const queue = useQueueState();
  const settings = useSettings();
  const enqueue = useEnqueueResearch();
  const countQuery = useQuery({
    queryKey: ["domains-count", filter ? filterToSearchParams(filter).toString() : ""],
    queryFn: () => api.get<{ total: number }>(`/domains/count?${filterToSearchParams(filter ?? {}).toString()}`),
    enabled: open && filter !== undefined,
  });

  const count = domainIds ? domainIds.length : countQuery.data?.total;
  const maxPerRequest = settings.data?.research.maxEnqueuePerRequest ?? 0;
  const remaining = queue.data ? Math.max(0, queue.data.dailyLimit - queue.data.usageToday.domains) : null;
  const overLimit = count !== undefined && maxPerRequest > 0 && count > maxPerRequest;

  const submit = async () => {
    try {
      const result = await enqueue.mutateAsync(
        domainIds ? { domainIds, force } : { filter, confirmCount: count, force },
      );
      const parts = [`${formatNumber(result.enqueued)} queued`];
      if (result.alreadyQueued) parts.push(`${formatNumber(result.alreadyQueued)} already queued`);
      if (result.skippedRecent) parts.push(`${formatNumber(result.skippedRecent)} researched in the last 24h`);
      toast(parts.join(" · "), "success");
      onQueued?.();
      onClose();
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Queue DataForSEO research"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!count || overLimit || enqueue.isPending} onClick={submit}>
            {enqueue.isPending ? <Spinner /> : null}
            Queue {count !== undefined ? formatNumber(count) : ""} domain{count === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {count === undefined ? (
          <p className="flex items-center gap-2">
            <Spinner /> Counting matching domains…
          </p>
        ) : (
          <p>
            <strong>{formatNumber(count)}</strong> domain{count === 1 ? "" : "s"} will be added to the research queue.
            Jobs run in the background in small batches; nothing is researched immediately.
          </p>
        )}
        {queue.data && (
          <p className="text-slate-600">
            Daily research budget: {formatNumber(queue.data.usageToday.domains)} of {formatNumber(queue.data.dailyLimit)} used
            {remaining !== null && ` (${formatNumber(remaining)} remaining today)`}. Domains beyond the budget wait until tomorrow.
          </p>
        )}
        {overLimit && (
          <Banner tone="error">
            This exceeds the per-request limit of {formatNumber(maxPerRequest)}. Narrow the filter first, or raise the limit in
            Settings.
          </Banner>
        )}
        {queue.data?.paused && <Banner tone="warning">The queue is paused: {queue.data.pauseReason ?? "paused"}.</Banner>}
        {queue.data && !queue.data.providerConfigured && (
          <Banner tone="warning">DataForSEO is not configured, so queued jobs will wait until credentials are set.</Banner>
        )}
      </div>
    </Modal>
  );
}
