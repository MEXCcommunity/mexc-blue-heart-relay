import { mark } from "../prototype/geometry.json";
import { recordArrival, recordClick } from "./analytics";
import { serveAdmin } from "./admin";
import type { AccessEnv } from "./access";

const cookieName = "mexc_relay_browser_v1";
const tokenFormat = /^[a-f0-9]{32}$/;
const handleFormat = /^[A-Za-z0-9_]{1,15}$/;
const uidFormat = /^[0-9]{1,32}$/;
const maxContributions = mark.length;

type Pixel = {
  position: number;
  share: string;
  message: string | null;
  handle: string | null;
};
type OwnPixel = Pixel & { uid: string | null };
type Count = { total: number };

function browserId(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim())
    .find(value => value.startsWith(cookieName + "="));
  const value = cookie?.slice(cookieName.length + 1) ?? "";
  return tokenFormat.test(value) ? value : "";
}

function token() {
  return crypto.randomUUID().replaceAll("-", "");
}

function respond(payload: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(payload, { status, headers });
}

async function board(db: D1Database, browser: string, referral: string) {
  const includeReferral = tokenFormat.test(referral);
  const [count, mine, incoming, relays, notes] = await db.batch<Pixel | OwnPixel | Count>([
    db.prepare("SELECT COUNT(*) AS total FROM relay_pixels"),
    db.prepare("SELECT position, share, message, handle, mexc_uid AS uid FROM relay_pixels WHERE browser = ?").bind(browser),
    db.prepare("SELECT position, share, message, handle FROM relay_pixels WHERE share = ?").bind(includeReferral ? referral : ""),
    db.prepare("SELECT COUNT(*) AS total FROM relay_pixels WHERE invited_by = (SELECT share FROM relay_pixels WHERE browser = ?)").bind(browser),
    db.prepare("SELECT position, share, message, handle FROM relay_pixels WHERE message IS NOT NULL ORDER BY position DESC LIMIT 10"),
  ]);
  return {
    count: Number((count.results[0] as Count | undefined)?.total ?? 0),
    mine: (mine.results[0] as OwnPixel | undefined) ?? null,
    incoming: (incoming.results[0] as Pixel | undefined) ?? null,
    relays: Number((relays.results[0] as Count | undefined)?.total ?? 0),
    notes: notes.results as Pixel[],
  };
}

async function readBoard(request: Request, db: D1Database) {
  const url = new URL(request.url);
  const previous = browserId(request);
  const browser = previous || token();
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const cookie = previous ? undefined :
    `${cookieName}=${browser}; Path=/api/relay; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`;
  return respond(await board(db, browser, url.searchParams.get("ref") ?? ""), 200, cookie);
}

async function updateBoard(request: Request, db: D1Database) {
  const browser = browserId(request);
  if (!browser) return respond({ error: "Your browser did not save your session. Refresh the page and try again." }, 409);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return respond({ error: "This request came from an invalid origin." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return respond({ error: "Invalid request format." }, 415);
  }
  const raw = await request.text();
  if (raw.length > 1800) return respond({ error: "The note is too long." }, 413);
  let input;
  try { input = JSON.parse(raw); }
  catch { return respond({ error: "Invalid request format." }, 400); }
  if (!input || typeof input !== "object") return respond({ error: "Invalid request format." }, 400);
  const referral = typeof input.ref === "string" && tokenFormat.test(input.ref) ? input.ref : "";
  const now = Date.now();
  if (input.action === "visit") {
    await recordArrival(db, browser, referral, input.source, maxContributions, now).run();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } else if (input.action === "light") {
    await db.batch([
      recordArrival(db, browser, referral, input.source, maxContributions, now),
      recordClick(db, browser, now),
      db.prepare(`INSERT INTO relay_pixels (browser, share, invited_by, created)
      SELECT ?, ?, (SELECT share FROM relay_pixels WHERE share = ? AND browser <> ?), ?
      WHERE NOT EXISTS (SELECT 1 FROM relay_pixels WHERE browser = ?)
        AND (SELECT COUNT(*) FROM relay_pixels) < ?`)
        .bind(browser, token(), referral, browser, now, browser, maxContributions),
    ]);
    const result = await board(db, browser, referral);
    return result.mine ? respond(result) : respond({ error: "The map is full." }, 409);
  } else if (input.action === "note") {
    const message = typeof input.message === "string" ? input.message.trim() : "";
    const handle = typeof input.handle === "string" ? input.handle.trim().replace(/^@/, "") : "";
    const uid = typeof input.uid === "string" ? input.uid.trim() : null;
    if (!message || [...message].length > 80 || /[\r\n]/.test(message)) {
      return respond({ error: "Write one line of up to 80 characters." }, 400);
    }
    if (handle && (!handleFormat.test(handle) || input.consent !== true)) {
      return respond({ error: "Enter a valid X handle and consent to display it, or leave the handle blank to post anonymously." }, 400);
    }
    if (input.uid !== undefined && (uid === null || (uid !== "" && !uidFormat.test(uid)))) {
      return respond({ error: "Enter a MEXC UID using digits only, or leave it blank." }, 400);
    }
    // An omitted UID preserves the value for older clients. An empty field clears it.
    const update = await db.prepare(`UPDATE relay_pixels
      SET message = ?, handle = ?, mexc_uid = NULLIF(COALESCE(?, mexc_uid), ''),
        mexc_uid_at = CASE
          WHEN ? IS NULL THEN mexc_uid_at
          WHEN ? = '' THEN NULL
          WHEN ? = mexc_uid THEN COALESCE(mexc_uid_at, ?)
          ELSE ?
        END
      WHERE browser = ?`).bind(message, handle || null, uid, uid, uid, uid, now, now, browser).run();
    if (update.meta.changes === 0) return respond({ error: "Light up a pixel first." }, 409);
  } else if (input.action === "remove-note") {
    await db.prepare("UPDATE relay_pixels SET message = NULL, handle = NULL, mexc_uid = NULL, mexc_uid_at = NULL WHERE browser = ?").bind(browser).run();
  } else {
    return respond({ error: "This action is not supported." }, 400);
  }
  return respond(await board(db, browser, referral));
}

interface Env extends AccessEnv {
  DB: D1Database;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/")) {
      return serveAdmin(request, url, env);
    }
    if (pathname !== "/api/relay") {
      return respond({ error: "Not found." }, 404);
    }
    if (!env.DB) {
      return respond({ error: "The shared map is temporarily unavailable." }, 503);
    }
    if (request.method === "GET") return readBoard(request, env.DB);
    if (request.method === "POST") return updateBoard(request, env.DB);
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  },
} satisfies ExportedHandler<Env>;
