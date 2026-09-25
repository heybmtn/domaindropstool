import { DomainExplorer } from "../components/DomainExplorer";
import { PageHeader } from "../components/ui";

export function DomainsPage() {
  return (
    <>
      <PageHeader
        title="Domains"
        description="Every .co.uk domain seen on a Nominet drop list. Filter cheaply first, then research the candidates."
      />
      <DomainExplorer defaults={{ filter: { domainStatus: "listed" } }} />
    </>
  );
}
