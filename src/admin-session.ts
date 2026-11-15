export interface AdminPasswordEnv {
  ADMIN_PASSWORD?: string;
  DB: D1Database;
}

const lifetime = 8 * 60 * 60;
const limitMs = 15 * 60 * 1000;
const maxAttempts = 8;
const text = new TextEncoder();

export function configuredPassword(env: AdminPasswordEnv) {
  const password = env.ADMIN_PASSWORD?.trim();
  return password && password.length >= 24 && password.length <= 256 ? password : null;
}

function cookieName(url: URL) {
  if (url.protocol === "https:") return "__Host-mexc-admin";
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "mexc-admin-local";
  return null;
}

function hex(buffer: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, "0")).join("");
}

async function sessionHash(password: string, token: string) {
  const key = await crypto.subtle.importKey("raw", text.encode(password), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, text.encode("admin-session-v1:" + token)));
}

async function passwordMatches(password: string, submitted: string) {
  const encoder = (value: string) => crypto.subtle.digest("SHA-256", text.encode(value));
  const [expected, actual] = await Promise.all([encoder(password), encoder(submitted)]);
  const key = await crypto.subtle.importKey("raw", expected, {name:"HMAC", hash:"SHA-256"}, false, ["sign", "verify"]);
  const check = await crypto.subtle.sign("HMAC", key, actual);
  return crypto.subtle.verify("HMAC", key, check, expected);
}

function sessionCookie(url: URL, name: string, value: string, maxAge: number) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${url.protocol === "https:" ? "; Secure" : ""}`;
}

async function sessionKey(request: Request, url: URL, env: AdminPasswordEnv) {
  const name = cookieName(url);
  const password = configuredPassword(env);
  if (!name || !password) return null;
  const token = request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(name + "="))?.slice(name.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? sessionHash(password, token) : null;
}

export async function passwordSession(request: Request, url: URL, env: AdminPasswordEnv) {
  const key = await sessionKey(request, url, env);
  if (!key) return false;
  return Boolean(await env.DB.prepare("SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(key, Date.now()).first());
}

export function sameOrigin(request: Request, url: URL) {
  return request.headers.get("Origin") === url.origin;
}

export async function signIn(request: Request, url: URL, env: AdminPasswordEnv) {
  const password = configuredPassword(env);
  const name = cookieName(url);
  if (!password || !name) return { status:503 };
  if (!sameOrigin(request, url)) return { status:403 };
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return { status:400 };
  }
  const body = await smallBody(request);
  if (body === null) return { status:400 };
  const submitted = new URLSearchParams(body).get("password");
  if (!submitted || submitted.length > 256) return { status:400 };

  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const client = await sessionHash(password, "login-ip:" + ip);
  const [, attempt] = await env.DB.batch<{ attempts:number }>([
    env.DB.prepare("DELETE FROM admin_login_limits WHERE expires_at <= ?").bind(now),
    env.DB.prepare(`INSERT INTO admin_login_limits (client_key, expires_at, attempts)
      VALUES (?, ?, 1) ON CONFLICT (client_key) DO UPDATE SET
      attempts = MIN(admin_login_limits.attempts + 1, ?) RETURNING attempts`)
      .bind(client, now + limitMs, maxAttempts + 1),
  ]);
  if ((attempt.results[0]?.attempts ?? maxAttempts + 1) > maxAttempts) return { status:429 };
  if (!await passwordMatches(password, submitted)) return { status:401 };

  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sessionHash(password, token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)").bind(hash, now + lifetime * 1000),
    env.DB.prepare("DELETE FROM admin_login_limits WHERE client_key = ?").bind(client),
  ]);
  return { status:303, cookie:sessionCookie(url, name, token, lifetime) };
}

async function smallBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 2048) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, {stream:true});
    }
  } finally {
    reader.releaseLock();
  }
}

export async function signOut(request: Request, url: URL, env: AdminPasswordEnv) {
  const name = cookieName(url);
  if (!name || !sameOrigin(request, url)) return { status:403 };
  const hash = await sessionKey(request, url, env);
  if (hash) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(hash).run();
  return { status:303, cookie:sessionCookie(url, name, "", 0) };
}
