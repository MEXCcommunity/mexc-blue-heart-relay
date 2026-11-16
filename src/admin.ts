import adminPage from "./admin.html";
import { adminIdentity, type AccessEnv } from "./access";
import { configuredPassword, passwordSession, signIn, signOut, type AdminPasswordEnv } from "./admin-session";
import { analyticsReport, channelCsv, participantRows, readFilters, uidRows } from "./analytics";

type AdminEnv = AccessEnv & AdminPasswordEnv;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function csvCell(value: string | number) {
  let text = String(value);
  // User-supplied text must not be interpreted as a spreadsheet formula on import.
  if (typeof value === "string" && /^(?:[\t\r\n]|\s*[=+\-@＝＋－＠])/u.test(value)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

function csv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  return new Response("\uFEFF" + content + "\r\n", {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

const timestamp = (value: number | null) => value === null ? "" : new Date(value).toISOString();

const pageHeaders = {
  ...privateHeaders,
  "Referrer-Policy": "same-origin",
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function signInPage(status = 200) {
  const message = status === 429 ? "Too many attempts. Try again in a few minutes."
    : status === 401 ? "Incorrect password." : status === 400 ? "Enter your password." : "";
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Staff sign-in | MEXC Blue Heart Relay</title>
<style>
* { box-sizing:border-box; }
:root { color-scheme:dark; font:16px/1.5 Inter,system-ui,sans-serif; background:#0a1020; color:#eef4ff; }
body { margin:0; }
main { width:min(440px,calc(100% - 32px)); margin:clamp(24px,12vh,100px) auto; padding:clamp(20px,5vw,32px); border:1px solid #283c5e; border-radius:14px; background:#141f33; }
p { margin:0; color:#a6b7d2; } h1 { margin:7px 0 18px; font-size:clamp(24px,6vw,32px); }
label { display:block; } input,button { font:inherit; width:100%; min-height:44px; border-radius:8px; }
input { margin-top:6px; padding:8px 12px; border:1px solid #405879; background:#0a1020; color:inherit; }
button { margin-top:14px; border:1px solid #4d82eb; background:#2964da; color:#fff; font-weight:700; cursor:pointer; }
:focus-visible { outline:2px solid #79adff; outline-offset:3px; } [role=alert] { color:#ffb9bf; margin-top:10px; }
</style></head>
<body><main><p>💪💙 MEXC Blue Heart Relay</p><h1>Staff sign-in</h1>
<form action="/admin/login" method="post">
<label for="password">Admin password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256">
${message ? `<p role="alert">${message}</p>` : ""}
<button type="submit">Sign in</button>
</form></main></body></html>`, { status, headers:{...pageHeaders, ...(status === 429 ? {"Retry-After":"900"} : {})} });
}

function redirectAdmin(cookie?: string) {
  const headers = new Headers({ ...privateHeaders, Location:"/admin" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status:303, headers });
}

export async function serveAdmin(request: Request, url: URL, env: AdminEnv) {
  const atLogin = url.pathname === "/admin/login";
  const atLogout = url.pathname === "/admin/logout";
  const adminHome = url.pathname === "/admin" || url.pathname === "/admin/";
  const passwordEnabled = Boolean(configuredPassword(env));
  const accessEnabled = Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUDIENCE);
  if (!passwordEnabled && !accessEnabled) {
    return new Response("Staff sign-in has not been configured.", { status:503, headers:privateHeaders });
  }
  if (atLogin || atLogout) {
    if (!passwordEnabled) return new Response(null, { status:404, headers:privateHeaders });
    if (request.method !== "POST") return new Response(null, { status:405, headers:{ ...privateHeaders, Allow:"POST" } });
    const result = await (atLogin ? signIn : signOut)(request, url, env);
    if (result.status === 303) return redirectAdmin(result.cookie);
    if ([400,401,429].includes(result.status)) return signInPage(result.status);
    return new Response(null, { status:result.status, headers:privateHeaders });
  }
  if (request.method !== "GET") return new Response(null, { status:405, headers:{ ...privateHeaders, Allow:"GET" } });
  const signedInWithPassword = passwordEnabled && await passwordSession(request, url, env);
  const identity = signedInWithPassword ? { canExportUid:true } : await adminIdentity(request, env);
  if (!identity) {
    if (adminHome && passwordEnabled) return signInPage();
    return new Response("Staff sign-in required.", { status:403, headers:privateHeaders });
  }
  if (adminHome) {
    const page = adminPage.replace("__PARTICIPANT_EXPORT_HIDDEN__", identity.canExportUid ? "" : "hidden");
    return new Response(page, { headers:pageHeaders });
  }
  if (url.pathname === "/api/admin/participants.csv") {
    if (!identity.canExportUid) return new Response("Participant export is not enabled for this account.", { status: 403, headers: privateHeaders });
    const rows = await participantRows(env.DB);
    return csv("mexc-campaign-participants.csv", [
      ["pixel_position", "mexc_uid", "note", "x_handle", "pixel_lit_at_utc"],
      ...rows.map(row => [row.position, row.mexc_uid ?? "", row.message ?? "", row.handle ?? "", timestamp(row.created)]),
    ]);
  }
  const filters = readFilters(url);
  if (!filters) return Response.json({ error: "Enter a valid date range and channel." }, { status: 400, headers: privateHeaders });
  if (url.pathname === "/api/admin/report") {
    const data = await analyticsReport(env.DB, filters);
    return Response.json({ ...data, ...identity, signedInWithPassword }, { headers: privateHeaders });
  }
  if (url.pathname === "/api/admin/channels.csv") {
    return csv("mexc-campaign-channels.csv", channelCsv(await analyticsReport(env.DB, filters)));
  }
  if (url.pathname === "/api/admin/uids.csv") {
    if (!identity.canExportUid) return new Response("UID export is not enabled for this account.", { status: 403, headers: privateHeaders });
    const rows = await uidRows(env.DB, filters);
    return csv("mexc-campaign-uids.csv", [
      ["mexc_uid", "first_pixel_at_utc", "uid_submitted_at_utc", "first_arrival_source", "uid_status"],
      ...rows.map(row => [row.uid, timestamp(row.created), timestamp(row.mexc_uid_at), row.source, "self_reported"]),
    ]);
  }
  return new Response(null, { status: 404, headers: privateHeaders });
}
