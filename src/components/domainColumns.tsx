import { Link } from "react-router";
import type { DomainRow } from "../../shared/api";
import type { SortField } from "../../shared/filters";
import { formatCompact, formatDate, formatMoney, formatNumber, relativeDays } from "../lib/format";
import { DomainStatusBadge, ResearchBadge, UserStatusBadge } from "./ui";

export interface DomainColumn {
  key: string;
  label: string;
  title?: string;
  sort?: SortField;
  align?: "right";
  defaultVisible: boolean;
  render: (row: DomainRow) => React.ReactNode;
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
    sort: "domain",
    defaultVisible: true,
    render: (row) => (
      <Link to={`/domains/${row.id}`} className="font-medium text-blue-800 hover:underline">
        {row.sld}
        <span className="text-slate-400">.{row.tld}</span>
      </Link>
    ),
  },
  { key: "dropDate", label: "Drop Date", sort: "drop_date", defaultVisible: true, render: (row) => formatDate(row.dropDate) },
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
