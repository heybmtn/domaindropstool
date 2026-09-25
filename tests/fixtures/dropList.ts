/**
 * Synthetic drop-list fixtures shaped like Nominet's uk.csv.gz
 * (ROID, domain, drop time UTC). Not real Nominet data.
 */
export const SAMPLE_DROP_LIST_CSV = [
  "ROID,Domain Name,Drop Time",
  "1001-UK,example.co.uk,2026-09-25T13:00:00Z",
  "1002-UK,EXAMPLE-TWO.CO.UK,2026-09-25T13:00:00Z",
  "1003-UK,trailing.co.uk.,2026-09-26T13:00:00Z",
  "1004-UK,  spaced.co.uk  ,2026-09-26 13:00:00",
  "1005-UK,example.co.uk,2026-09-25T13:00:00Z",
  "1006-UK,other.org.uk,2026-09-25T13:00:00Z",
  "1007-UK,plain.uk,2026-09-25T13:00:00Z",
  "1008-UK,bad_domain!.co.uk,2026-09-25T13:00:00Z",
  "1009-UK,-leading.co.uk,2026-09-25T13:00:00Z",
  "1010-UK,sub.domain.co.uk,2026-09-25T13:00:00Z",
  "1011-UK,shop4you.co.uk,2026-09-27T13:00:00Z",
  "",
].join("\n");

/** Valid unique .co.uk domains in SAMPLE_DROP_LIST_CSV. */
export const SAMPLE_VALID_DOMAINS = [
  "example.co.uk",
  "example-two.co.uk",
  "trailing.co.uk",
  "spaced.co.uk",
  "shop4you.co.uk",
];

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function csvWith(rows: [string, string][], header = "ROID,Domain Name,Drop Time"): string {
  return [header, ...rows.map(([domain, time], i) => `${2000 + i}-UK,${domain},${time}`)].join("\n");
}
