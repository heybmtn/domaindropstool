/**
 * Minimal Cloudflare Access JWT verification (RS256) using WebCrypto.
 * Keys are fetched from `<team domain>/cdn-cgi/access/certs` and cached briefly.
 */
interface Jwk extends JsonWebKey {
  kid?: string;
}

interface AccessClaims {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  sub?: string;
}

const KEY_TTL_MS = 10 * 60 * 1000;
let cachedKeys: { teamDomain: string; fetchedAt: number; keys: Jwk[] } | null = null;

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
}

async function getKeys(teamDomain: string): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < KEY_TTL_MS) {
    return cachedKeys.keys;
  }
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs request failed with ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  cachedKeys = { teamDomain, fetchedAt: Date.now(), keys };
  return keys;
}

export function normaliseTeamDomain(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/\/+$/, "");
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

/** Returns the verified identity (email or subject) or null when the token is invalid. */
export async function verifyAccessJwt(token: string, teamDomainRaw: string, audience: string): Promise<string | null> {
  const teamDomain = normaliseTeamDomain(teamDomainRaw);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = decodeJson(headerPart);
    claims = decodeJson(payloadPart);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;

  const keys = await getKeys(teamDomain);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return null;
  if (claims.iss !== teamDomain) return null;
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds) return null;
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds + 60) return null;
  return claims.email ?? claims.sub ?? "access-user";
}
