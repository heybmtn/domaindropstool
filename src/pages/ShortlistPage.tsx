import { DomainExplorer } from "../components/DomainExplorer";
import { PageHeader } from "../components/ui";

const SHORTLIST_COLUMNS = [
  "domain",
  "dropDate",
  "researchScore",
  "referringDomains",
  "backlinks",
  "organicTraffic",
  "organicKeywords",
  "noteCount",
  "userStatus",
  "status",
];

export function ShortlistPage() {
  return (
    <>
      <PageHeader title="Shortlist" description="Domains you have starred for detailed review. Use Set status for bulk changes." />
      <DomainExplorer
        defaults={{ sort: "research_score", dir: "desc" }}
        fixedFilter={{ shortlisted: true }}
        exportScope="shortlist"
        columnsKey="ddr.shortlistColumns"
        defaultColumns={SHORTLIST_COLUMNS}
      />
    </>
  );
}
