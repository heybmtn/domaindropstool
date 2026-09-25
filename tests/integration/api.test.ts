import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainRow, Paginated } from "../../shared/api";
import { gzip, SAMPLE_DROP_LIST_CSV } from "../fixtures/dropList";
import { resetDatabase, seedDomains } from "../helpers";

const ADMIN = { Authorization: "Bearer test-admin-token" };
const api = (path: string, init?: RequestInit) => SELF.fetch(`https://app.test/api${path}`, init);

describe("API", () => {
  beforeEach(resetDatabase);

  it("protects admin operations", async () => {
    for (const [path, method] of [
      ["/import", "POST"],
      ["/research", "POST"],
      ["/research/pause", "POST"],
      ["/research/resume", "POST"],
    ] as const) {
      const response = await api(path, { method, body: "{}" });
      expect(response.status, path).toBe(401);
    }
    const wrong = await api("/research/pause", { method: "POST", headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    const ok = await api("/research/pause", { method: "POST", headers: ADMIN });
    expect(ok.status).toBe(200);
  });

  it("returns safe, structured errors", async () => {
    const response = await api("/domains?pageSize=100000");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.requestId).toBeTruthy();
  });

  it("lists domains with server-side filters, sorting and pagination", async () => {
    await seedDomains([
      { domain: "short.co.uk", referringDomains: 50, organicTraffic: 900 },
      { domain: "a-very-long-hyphen.co.uk", referringDomains: 500 },
      { domain: "shop4u.co.uk", referringDomains: 10 },
      { domain: "tomorrow.co.uk", dropDate: "2026-09-26", referringDomains: 80 },
    ]);
    const response = await api("/domains?drop=2026-09-25&maxLength=15&hasHyphen=false&minRD=20&sort=referring_domains&dir=desc");
    const page = (await response.json()) as Paginated<DomainRow>;
    expect(page.items.map((d) => d.domain)).toEqual(["short.co.uk"]);
    expect(page.total).toBe(1);

    const paged = (await (await api("/domains?pageSize=2&page=2&sort=domain")).json()) as Paginated<DomainRow>;
    expect(paged.total).toBe(4);
    expect(paged.items.map((d) => d.domain)).toEqual(["short.co.uk", "tomorrow.co.uk"]);
  });

  it("imports an uploaded drop list", async () => {
    const response = await api("/import/upload?filename=uk.csv.gz", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/gzip" },
      body: await gzip(SAMPLE_DROP_LIST_CSV),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { outcome: string; batch: { insertedRecords: number } };
    expect(body).toMatchObject({ outcome: "imported", batch: { insertedRecords: 5 } });
    const history = (await (await api("/import/history")).json()) as { items: unknown[] };
    expect(history.items).toHaveLength(1);
  });

  it("supports saved filters, notes, shortlist and CSV export", async () => {
    const [id] = await seedDomains([{ domain: "cmd.co.uk" }, { domain: "other.co.uk" }]);

    const saved = await api("/filters", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Mine", configuration: { maxLength: 10, minRD: 5 } }),
    });
    expect(saved.status).toBe(201);
    const duplicate = await api("/filters", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Mine", configuration: {} }),
    });
    expect(duplicate.status).toBe(409);

    const note = await api(`/domains/${id}/notes`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ note: '=HYPERLINK("x") <script>alert(1)</script>' }),
    });
    expect(note.status).toBe(201);

    expect((await api("/shortlist", { method: "POST", headers: ADMIN, body: JSON.stringify({ domainIds: [id] }) })).status).toBe(201);
    const shortlist = (await (await api("/shortlist")).json()) as Paginated<DomainRow>;
    expect(shortlist.items.map((d) => d.domain)).toEqual(["cmd.co.uk"]);
    expect(shortlist.items[0]?.userStatus).toBe("shortlisted");

    const csv = await (await api("/export?scope=shortlist")).text();
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe(
      "domain,drop_date,length,hyphens,numbers,backlinks,referring_domains,organic_traffic,organic_keywords,traffic_value,research_score,status,notes",
    );
    expect(row).toContain("cmd.co.uk");
    expect(row).toContain(`"'=HYPERLINK(""x"") <script>alert(1)</script>"`);

    const status = await api("/domains/status", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ domainIds: [id], userStatus: "registered" }),
    });
    expect(status.status).toBe(200);
    const detail = (await (await api(`/domains/${id}`)).json()) as { domain: DomainRow; isShortlisted: boolean };
    expect(detail.domain.userStatus).toBe("registered");
    expect(detail.isShortlisted).toBe(true);
  });

  it("requires confirmation for research of all filtered domains", async () => {
    await seedDomains([{ domain: "one.co.uk" }, { domain: "two.co.uk" }]);
    const unconfirmed = await api("/research", { method: "POST", headers: ADMIN, body: JSON.stringify({ filter: {} }) });
    expect(unconfirmed.status).toBe(409);
    const confirmed = await api("/research", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ filter: {}, confirmCount: 2 }),
    });
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toMatchObject({ enqueued: 2 });
  });

  it("never exposes DataForSEO credentials in settings", async () => {
    const text = await (await api("/settings")).text();
    expect(text).not.toMatch(/password/i);
    expect(JSON.parse(text).dataforseo).toMatchObject({ configured: false });
  });
});
