import { Link } from "react-router";
import { DomainExplorer } from "../components/DomainExplorer";
import { Banner, PageHeader, StatCard } from "../components/ui";
import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import { useQueueState, useStats } from "../lib/queries";

export function DashboardPage() {
  const stats = useStats();
  const queue = useQueueState(15_000);
  const s = stats.data;
  const nextDrop = s?.upcomingDropDates.find((d) => d.dropDate > s.today);

  return (
    <>
      <PageHeader
        title="Domain Drop Research"
        description={
          s?.lastImport
            ? `Last import ${formatDateTime(s.lastImport.completedAt)} · ${formatNumber(s.listedDomains)} domains on the current drop list`
            : "No drop list imported yet."
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's domains" value={s ? formatNumber(s.todaysDomains) : "…"} hint={s ? formatDate(s.today) : undefined} />
        <StatCard label="Researched" value={s ? formatNumber(s.researched) : "…"} />
        <StatCard label="Unresearched" value={s ? formatNumber(s.unresearched) : "…"} />
        <StatCard label="Shortlisted" value={s ? formatNumber(s.shortlisted) : "…"} />
      </div>

      <div className="mb-4 space-y-2">
        {s && s.totalDomains === 0 && (
          <Banner tone="info">
            No domains yet. <Link className="underline" to="/imports">Import the Nominet drop list</Link> to get started.
          </Banner>
        )}
        {s && s.todaysDomains === 0 && nextDrop && (
          <Banner tone="info">
            Nothing drops today. Next drop date: <Link className="underline" to={`/?drop=${nextDrop.dropDate}`}>{formatDate(nextDrop.dropDate)}</Link>{" "}
            ({formatNumber(nextDrop.count)} domains).
          </Banner>
        )}
        {queue.data?.paused && (
          <Banner tone="warning">
            Research queue paused: {queue.data.pauseReason ?? "paused"} <Link className="underline" to="/queue">Manage queue</Link>
          </Banner>
        )}
        {queue.data?.limitReached && (
          <Banner tone="warning">Daily research limit reached ({formatNumber(queue.data.dailyLimit)} domains). Queued jobs resume tomorrow (UTC).</Banner>
        )}
      </div>

      <DomainExplorer defaults={{ filter: { dropDate: "today" } }} />
    </>
  );
}
