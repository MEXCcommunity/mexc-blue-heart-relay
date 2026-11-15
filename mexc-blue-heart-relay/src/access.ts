export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  UID_EXPORT_EMAILS?: string;
}

type Claims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
};

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]+$/.test(value)) throw new Error("Invalid token encoding");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
}

const utf8 = new TextDecoder();
const encoder = new TextEncoder();
let cachedKeys: { issuer: string; expires: number; keys: Array<JsonWebKey & { kid: string }> } | undefined;

async function signingKey(issuer: string, kid: string) {
  const previous = cachedKeys;
  if (previous?.issuer === issuer && previous.expires > Date.now()) {
    const key = previous.keys.find(candidate => candidate.kid === kid);
    if (key) return key;
    // Allow key rotation without fetching on every request with an unknown key ID.
    if (previous.expires > Date.now() + 270_000) return undefined;
  }
  const response = await fetch(issuer + "/cdn-cgi/access/certs", { redirect: "error" });
  if (!response.ok) return undefined;
  const body = await response.json<{ keys: Array<JsonWebKey & { kid: string }> }>();
  if (!Array.isArray(body.keys)) return undefined;
  cachedKeys = { issuer, expires: Date.now() + 300_000, keys: body.keys };
  return body.keys.find(candidate => candidate.kid === kid);
}

export async function adminIdentity(request: Request, env: AccessEnv) {
  const issuer = env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, "");
  const audience = env.ACCESS_AUDIENCE?.trim();
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience || !token || token.length > 8192) {
    return null;
  }
  try {
    const [header, payload, signature, ...extra] = token.split(".");
    if (!header || !payload || !signature || extra.length) return null;
    const { alg, kid } = JSON.parse(utf8.decode(decode(header)));
    if (alg !== "RS256" || typeof kid !== "string") return null;

    const claims = JSON.parse(utf8.decode(decode(payload))) as Claims;
    const now = Date.now() / 1000;
    if (claims.iss !== issuer || ![claims.aud].flat().includes(audience)
      || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now
      || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now))
      || typeof claims.email !== "string" || !claims.email.trim()) return null;

    const jwk = await signingKey(issuer, kid);
    if (!jwk || jwk.kty !== "RSA") return null;
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    const valid = await crypto.subtle.verify(algorithm.name, key, decode(signature), encoder.encode(header + "." + payload));
    if (!valid) return null;

    const email = claims.email.trim().toLowerCase();
    const exporters = (env.UID_EXPORT_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase());
    return { canExportUid: exporters.includes(email) };
  } catch {
    return null;
  }
}
