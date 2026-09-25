import { Link } from "react-router";
import type { DomainRow } from "../../shared/api";
import { registrarLabel, registrarUrl, type RegistrarSettings } from "../../shared/registrar";
import type { SortField } from "../../shared/filters";
import { formatCompact, formatDate, formatDropClock, formatDropDay, formatMoney, formatNumber, formatUtc, relativeDays, timeUntil } from "../lib/format";
import { DomainStatusBadge, ResearchBadge, UserStatusBadge } from "./ui";

export interface DomainColumn {
  key: string;
  label: string;
  title?: string;
  sort?: SortField;
  align?: "right";
  defaultVisible: boolean;
  render: (row: DomainRow, context: ColumnContext) => React.ReactNode;
}

export interface ColumnContext {
  registrar: RegistrarSettings;
}

/** Domain name opens the registrar's availability search in a new tab; the icon opens the details page. */
function DomainCell({ row, registrar }: { row: DomainRow; registrar: RegistrarSettings }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={registrarUrl(registrar, row.domain)}
        target="_blank"
        rel="noopener noreferrer"
        title={`Check availability on ${registrarLabel(registrar)} (opens a new tab)`}
        className="font-medium text-blue-800 hover:underline"
      >
        {row.sld}
        <span className="text-slate-400">.{row.tld}</span>
      </a>
      <Link
        to={`/domains/${row.id}`}
        aria-label={`View details for ${row.domain}`}
        title="View details"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
        </svg>
      </Link>
    </span>
  );
}

function DropTimeCell({ dropTime, dropDate }: { dropTime: string | null; dropDate: string | null }) {
  if (!dropTime) return <>{formatDate(dropDate)}</>;
  const countdown = timeUntil(dropTime);
  return (
    <span title={formatUtc(dropTime)} className="inline-flex items-baseline gap-2">
      <span className="text-slate-500">{formatDropDay(dropTime)}</span>
      <span className="font-mono text-slate-900">{formatDropClock(dropTime)}</span>
      {countdown && (
        <span className={`text-[11px] ${countdown === "dropped" ? "text-slate-400" : "font-medium text-amber-700"}`}>{countdown}</span>
      )}
    </span>
  );
}

function scoreClass(score: number): string {
  if (score >= 60) return "bg-emerald-100 text-emerald-800";
  if (score >= 35) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export const DOMAIN_COLUMNS: DomainColumn[] = [
  {
    key: "domain",
    label: "Domain",
    title: "Click a domain to check availability at your registrar (Settings → Registrar). The ⓘ icon opens its details.",
    sort: "domain",
    defaultVisible: true,
    render: (row, context) => <DomainCell row={row} registrar={context.registrar} />,
  },
  {
    key: "dropDate",
    label: "Drop (UK time)",
    title: "When the domain drops, in UK time (BST/GMT). Hover a value for the exact UTC time.",
    sort: "drop_date",
    defaultVisible: true,
    render: (row) => <DropTimeCell dropTime={row.dropTime} dropDate={row.dropDate} />,
  },
  { key: "length", label: "Length", sort: "length", align: "right", defaultVisible: true, render: (row) => row.length },
  {
    key: "referringDomains",
    label: "Ref. Domains",
    title: "Referring domains (latest snapshot)",
    sort: "referring_domains",
    align: "right",
    defaultVisible: true,
    render: (row) => formatCompact(row.referringDomains),
  },
  { key: "backlinks", label: "Backlinks", sort: "backlinks", align: "right", defaultVisible: true, render: (row) => formatCompact(row.backlinks) },
  {
    key: "organicTraffic",
    label: "Traffic",
    title: "Estimated monthly organic traffic",
    sort: "organic_traffic",
    align: "right",
    defaultVisible: true,
    render: (row) => formatCompact(row.organicTraffic === null ? null : Math.round(row.organicTraffic)),
  },
  {
    key: "organicKeywords",
    label: "Keywords",
    sort: "organic_keywords",
    align: "right",
    defaultVisible: true,
    render: (row) => formatCompact(row.organicKeywords),
  },
  {
    key: "researchScore",
    label: "Research Score",
    title: "Transparent prioritisation score (0–100). Not a valuation. Open a domain to see the breakdown.",
    sort: "research_score",
    align: "right",
    defaultVisible: true,
    render: (row) =>
      row.researchScore === null ? (
        <span className="text-slate-400">—</span>
      ) : (
        <span className={`tabular inline-block min-w-8 rounded px-1.5 py-0.5 text-center font-semibold ${scoreClass(row.researchScore)}`}>
          {row.researchScore}
        </span>
      ),
  },
  { key: "researchStatus", label: "Research", defaultVisible: true, render: (row) => <ResearchBadge status={row.researchStatus} /> },
  { key: "status", label: "Domain Status", defaultVisible: true, render: (row) => <DomainStatusBadge status={row.status} /> },
  { key: "userStatus", label: "My Status", defaultVisible: false, render: (row) => <UserStatusBadge status={row.userStatus} /> },
  { key: "hyphens", label: "Hyphens", align: "right", defaultVisible: false, render: (row) => row.hyphens },
  { key: "digits", label: "Numbers", align: "right", defaultVisible: false, render: (row) => row.digits },
  {
    key: "trafficValue",
    label: "Traffic Value",
    sort: "traffic_value",
    align: "right",
    defaultVisible: false,
    render: (row) => formatMoney(row.trafficValue),
  },
  { key: "referringPages", label: "Ref. Pages", align: "right", defaultVisible: false, render: (row) => formatCompact(row.referringPages) },
  { key: "authority", label: "Authority", title: "Provider rank metric", align: "right", defaultVisible: false, render: (row) => formatNumber(row.authority) },
  {
    key: "lastResearchedAt",
    label: "Last Researched",
    sort: "last_researched_at",
    defaultVisible: false,
    render: (row) => relativeDays(row.lastResearchedAt),
  },
  { key: "firstSeenAt", label: "First Seen", sort: "created_at", defaultVisible: false, render: (row) => formatDate(row.firstSeenAt) },
  { key: "noteCount", label: "Notes", align: "right", defaultVisible: false, render: (row) => (row.noteCount > 0 ? row.noteCount : "") },
];

export const DEFAULT_VISIBLE_COLUMNS = DOMAIN_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
