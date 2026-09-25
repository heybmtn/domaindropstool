import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { BacklinkRow, DomainDetail, HistoryPoint, KeywordRow, MetricsSnapshot } from "../../shared/api";
import { USER_STATUSES, type UserStatus } from "../../shared/filters";
import { MetricChart } from "../components/MetricChart";
import { NotesPanel } from "../components/NotesPanel";
import { ResearchConfirmModal } from "../components/ResearchConfirmModal";
import { useToast } from "../components/Toast";
import {
  Badge,
  Banner,
  Button,
  Card,
  DomainStatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  ResearchBadge,
  UserStatusBadge,
} from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatCompact, formatDate, formatDropTime, formatMoney, formatNumber, formatUtc, relativeDays, timeUntil } from "../lib/format";
import { DEFAULT_REGISTRAR, registrarLabel, registrarUrl } from "../../shared/registrar";
import { keys, useSetUserStatus, useSettings, useShortlist, useUnshortlist } from "../lib/queries";

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular text-base font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function ScoreBreakdown({ detail }: { detail: DomainDetail }) {
  if (detail.domain.researchScore === null) {
    return <EmptyState title="No Research Score yet.">The score is calculated after DataForSEO research completes.</EmptyState>;
  }
  return (
    <div className="p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="tabular text-3xl font-semibold">{detail.domain.researchScore}</span>
        <span className="text-sm text-slate-500">/ 100 Research Score</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {detail.scoreBreakdown.map((line) => (
            <tr key={line.key} className="border-t border-slate-100" title={line.detail}>
              <td className="py-1 text-slate-700">{line.label}</td>
              <td className={`tabular py-1 text-right font-medium ${line.points < 0 ? "text-red-700" : "text-slate-900"}`}>
                {line.points > 0 ? "+" : ""}
                {line.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">
        A transparent prioritisation aid, not a valuation. Weights are configurable in Settings → Scoring.
      </p>
    </div>
  );
}

function KeywordsTable({ id }: { id: number }) {
  const query = useQuery({ queryKey: ["keywords", id], queryFn: () => api.get<{ items: KeywordRow[] }>(`/domains/${id}/keywords`) });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState message={errorText(query.error)} />;
  if (query.data.items.length === 0) return <EmptyState title="No ranking keywords captured." />;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th className="px-3 py-1.5">Keyword</th>
            <th className="px-3 py-1.5 text-right">Position</th>
            <th className="px-3 py-1.5 text-right">Search volume</th>
            <th className="px-3 py-1.5 text-right">Est. traffic</th>
            <th className="px-3 py-1.5">URL</th>
          </tr>
        </thead>
        <tbody>
          {query.data.items.map((row, index) => (
            <tr key={`${row.keyword}-${index}`} className="border-t border-slate-100">
              <td className="px-3 py-1.5">{row.keyword}</td>
              <td className="tabular px-3 py-1.5 text-right">{row.position ?? "—"}</td>
              <td className="tabular px-3 py-1.5 text-right">{formatNumber(row.searchVolume)}</td>
              <td className="tabular px-3 py-1.5 text-right">{formatNumber(row.etv === null ? null : Math.round(row.etv))}</td>
              <td className="max-w-64 truncate px-3 py-1.5 text-slate-500" title={row.url ?? ""}>
                {row.url ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BacklinksTable({ id }: { id: number }) {
  const query = useQuery({ queryKey: ["backlinks", id], queryFn: () => api.get<{ items: BacklinkRow[] }>(`/domains/${id}/backlinks`) });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState message={errorText(query.error)} />;
  if (query.data.items.length === 0) return <EmptyState title="No backlinks captured." />;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th className="px-3 py-1.5">Referring domain</th>
            <th className="px-3 py-1.5">Target URL</th>
            <th className="px-3 py-1.5">Anchor</th>
            <th className="px-3 py-1.5">Type</th>
            <th className="px-3 py-1.5 text-right" title="Provider rank of the referring domain">
              Domain rank
            </th>
          </tr>
        </thead>
        <tbody>
          {query.data.items.map((row, index) => (
            <tr key={`${row.sourceUrl}-${index}`} className="border-t border-slate-100">
              <td className="px-3 py-1.5" title={row.sourceUrl ?? ""}>
                {row.referringDomain ?? "—"}
              </td>
              <td className="max-w-56 truncate px-3 py-1.5 text-slate-500" title={row.targetUrl ?? ""}>
                {row.targetUrl ?? "—"}
              </td>
              <td className="max-w-48 truncate px-3 py-1.5">{row.anchor ?? <span className="text-slate-400">(empty)</span>}</td>
              <td className="px-3 py-1.5">{row.linkType ? <Badge tone={row.linkType === "dofollow" ? "green" : "slate"}>{row.linkType}</Badge> : "—"}</td>
              <td className="tabular px-3 py-1.5 text-right">{formatNumber(row.domainRank)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistorySection({ id }: { id: number }) {
  const query = useQuery({
    queryKey: ["metrics", id],
    queryFn: () => api.get<{ snapshots: MetricsSnapshot[]; providerHistory: HistoryPoint[] }>(`/domains/${id}/metrics`),
  });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState message={errorText(query.error)} />;
  const snapshots = [...query.data.snapshots].reverse();
  const series = (pick: (s: MetricsSnapshot) => number | null) => snapshots.map((s) => ({ label: s.metricDate, value: pick(s) }));
  const provider = query.data.providerHistory;
  return (
    <div className="space-y-3 p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricChart title="Backlinks" points={series((s) => s.backlinks)} />
        <MetricChart title="Referring domains" points={series((s) => s.referringDomains)} />
        <MetricChart title="Organic traffic" points={series((s) => (s.organicTraffic === null ? null : Math.round(s.organicTraffic)))} />
        <MetricChart title="Organic keywords" points={series((s) => s.organicKeywords)} />
      </div>
      {provider.length > 0 && (
        <MetricChart
          title="Provider-reported monthly organic traffic"
          points={provider.map((p) => ({ label: p.month, value: p.organicTraffic === null ? null : Math.round(p.organicTraffic) }))}
        />
      )}
      {snapshots.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-slate-600">Snapshot table ({snapshots.length})</summary>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1 text-right">Backlinks</th>
                <th className="px-2 py-1 text-right">Ref. domains</th>
                <th className="px-2 py-1 text-right">Traffic</th>
                <th className="px-2 py-1 text-right">Keywords</th>
                <th className="px-2 py-1 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((s) => (
                <tr key={s.id} className="tabular border-t border-slate-100">
                  <td className="px-2 py-1">{formatDate(s.metricDate)}</td>
                  <td className="px-2 py-1 text-right">{formatNumber(s.backlinks)}</td>
                  <td className="px-2 py-1 text-right">{formatNumber(s.referringDomains)}</td>
                  <td className="px-2 py-1 text-right">{formatNumber(s.organicTraffic === null ? null : Math.round(s.organicTraffic))}</td>
                  <td className="px-2 py-1 text-right">{formatNumber(s.organicKeywords)}</td>
                  <td className="px-2 py-1 text-right">{s.researchScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export function DomainDetailPage() {
  const id = Number(useParams().id);
  const toast = useToast();
  const navigate = useNavigate();
  const [researchOpen, setResearchOpen] = useState(false);
  const query = useQuery({
    queryKey: keys.domain(id),
    queryFn: () => api.get<DomainDetail>(`/domains/${id}`),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: (q) => {
      const status = q.state.data?.domain.researchStatus;
      return status === "pending" || status === "processing" ? 10_000 : false;
    },
  });
  const shortlist = useShortlist();
  const unshortlist = useUnshortlist();
  const setStatus = useSetUserStatus();
  const settings = useSettings();
  const registrar = settings.data?.registrar ?? DEFAULT_REGISTRAR;

  if (query.isPending) return <LoadingState label="Loading domain…" />;
  if (query.isError) return <ErrorState message={errorText(query.error)} onRetry={() => query.refetch()} />;
  const detail = query.data;
  const { domain, analysis, latest } = detail;

  const act = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast(label, "success");
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {domain.sld}
            <span className="text-slate-400">.{domain.tld}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {domain.dropTime ? (
              <span>
                Drops <strong className="font-mono text-slate-900">{formatDropTime(domain.dropTime)}</strong>{" "}
                <span className="text-xs text-slate-400">({formatUtc(domain.dropTime)})</span>{" "}
                {timeUntil(domain.dropTime) && <span className="text-xs font-medium text-amber-700">{timeUntil(domain.dropTime)}</span>}
              </span>
            ) : (
              <span>Drops {formatDate(domain.dropDate)}</span>
            )}
            <DomainStatusBadge status={domain.status} />
            <ResearchBadge status={domain.researchStatus} />
            <UserStatusBadge status={domain.userStatus} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={registrarUrl(registrar, domain.domain)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Check on {registrarLabel(registrar)} ↗
          </a>
          <Button variant="primary" onClick={() => setResearchOpen(true)} disabled={domain.researchStatus === "pending" || domain.researchStatus === "processing"}>
            {domain.researchStatus === "completed" ? "Refresh research" : "Research"}
          </Button>
          {detail.isShortlisted ? (
            <Button onClick={() => act("Removed from shortlist", () => unshortlist.mutateAsync(domain.id))}>★ Shortlisted</Button>
          ) : (
            <Button onClick={() => act("Added to shortlist", () => shortlist.mutateAsync([domain.id]))}>☆ Shortlist</Button>
          )}
          <select
            aria-label="Set status"
            className="input w-auto"
            value={domain.userStatus}
            onChange={(event) => act("Status updated", () => setStatus.mutateAsync({ domainIds: [domain.id], userStatus: event.target.value as UserStatus }))}
          >
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status === "none" ? "No status" : status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {detail.latestJob?.status === "failed" && (
        <Banner tone="error">Research failed. Retry available. {detail.latestJob.errorMessage && <span className="opacity-80">({detail.latestJob.errorMessage})</span>}</Banner>
      )}
      {detail.warnings.length > 0 && (
        <Card title="Research warnings">
          <ul className="space-y-1 p-3 text-sm text-amber-900">
            {detail.warnings.map((warning) => (
              <li key={warning.code}>⚠ {warning.message}</li>
            ))}
          </ul>
          <p className="px-3 pb-3 text-xs text-slate-500">Automated signals for manual review; they do not establish that a domain is spam or worthless.</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Overview (heuristics)">
          <dl className="grid grid-cols-3 gap-3 p-4">
            <Stat label="Length" value={analysis.length} />
            <Stat label="Hyphens" value={analysis.hyphens} />
            <Stat label="Numbers" value={analysis.digits} />
            <Stat label="Words" value={analysis.wordCount} title="Heuristic segmentation against a small common-word list" />
            <Stat label="Number ratio" value={`${Math.round(analysis.numberRatio * 100)}%`} />
            <Stat label="Vowel ratio" value={`${Math.round(analysis.vowelRatio * 100)}%`} />
          </dl>
          <div className="px-4 pb-4 text-sm">
            <span className="text-xs text-slate-500">Common word matches: </span>
            {analysis.words.length > 0 ? analysis.words.map((word) => <Badge key={word}>{word}</Badge>) : <span className="text-slate-400">none</span>}
            <p className="mt-2 text-xs text-slate-500">Local heuristics only. Not a market valuation.</p>
          </div>
        </Card>

        <Card title="SEO (latest snapshot)" className="lg:col-span-1">
          {latest ? (
            <>
              <dl className="grid grid-cols-2 gap-3 p-4">
                <Stat label="Backlinks" value={formatNumber(latest.backlinks)} />
                <Stat label="Referring domains" value={formatNumber(latest.referringDomains)} />
                <Stat label="Referring pages" value={formatNumber(latest.referringPages)} />
                <Stat label="Organic traffic" value={formatCompact(latest.organicTraffic === null ? null : Math.round(latest.organicTraffic))} />
                <Stat label="Organic keywords" value={formatNumber(latest.organicKeywords)} />
                <Stat label="Traffic value" value={formatMoney(latest.trafficValue)} title="Estimated monthly paid-search cost of the organic traffic" />
                <Stat label="Visibility" value={latest.visibility ?? "n/a"} title="Not provided by the current endpoints" />
                <Stat label="Authority (rank)" value={formatNumber(latest.authorityMetric)} title="DataForSEO backlinks rank" />
                <Stat label="Spam score" value={formatNumber(latest.spamScore)} title="Provider backlink spam score" />
              </dl>
              <p className="px-4 pb-4 text-xs text-slate-500">
                {latest.provider} · {formatDate(latest.metricDate)} · researched {relativeDays(domain.lastResearchedAt)}
              </p>
            </>
          ) : (
            <EmptyState title="Not researched yet.">Queue research to fetch DataForSEO metrics.</EmptyState>
          )}
        </Card>

        <Card title="Research Score">
          <ScoreBreakdown detail={detail} />
        </Card>
      </div>

      <Card title="Historical data">
        <HistorySection id={domain.id} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Top keywords">
          <KeywordsTable id={domain.id} />
        </Card>
        <Card title="Backlinks (one per referring domain)">
          <BacklinksTable id={domain.id} />
        </Card>
      </div>

      <NotesPanel domainId={domain.id} />

      <ResearchConfirmModal open={researchOpen} onClose={() => setResearchOpen(false)} domainIds={[domain.id]} force />
    </div>
  );
}
