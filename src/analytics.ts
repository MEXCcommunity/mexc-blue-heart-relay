export const channels = ["direct", "x", "telegram", "discord", "email", "community", "partner", "other", "relay"] as const;
type Channel = typeof channels[number];

function campaignSource(value: unknown): Channel {
  if (typeof value !== "string" || !value.trim()) return "direct";
  const source = value.trim().toLowerCase();
  if (source === "twitter") return "x";
  return channels.find(channel => channel === source && channel !== "relay") ?? "other";
}

export function recordArrival(db: D1Database, browser: string, referral: string, source: unknown, capacity: number, now: number) {
  return db.prepare(`INSERT INTO campaign_visitors (browser, arrived_at, source, eligible)
    SELECT ?, ?,
      CASE WHEN EXISTS (SELECT 1 FROM relay_pixels WHERE share = ? AND browser <> ?) THEN 'relay' ELSE ? END,
      CASE WHEN EXISTS (SELECT 1 FROM relay_pixels WHERE browser = ?)
        OR (SELECT COUNT(*) FROM relay_pixels) >= ? THEN 0 ELSE 1 END
    WHERE NOT EXISTS (SELECT 1 FROM campaign_visitors WHERE browser = ?)`)
    .bind(browser, now, referral, browser, campaignSource(source), browser, capacity, browser);
}

export function recordClick(db: D1Database, browser: string, now: number) {
  return db.prepare("UPDATE campaign_visitors SET clicked_at = ? WHERE browser = ? AND eligible = 1 AND clicked_at IS NULL")
    .bind(now, browser);
}

const day = 86_400_000;
const chinaOffset = 8 * 3_600_000;

function parseDate(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const epoch = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) return NaN;
  return epoch - chinaOffset;
}

export function readFilters(url: URL) {
  const params = url.searchParams;
  const from = parseDate(params.get("from"), 0);
  const to = parseDate(params.get("to"), Math.floor((Date.now() + chinaOffset) / day) * day - chinaOffset) + day;
  const source = params.get("source") || "";
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || (source && !channels.some(channel => channel === source))) {
    return null;
  }
  return { from, to, source };
}

type Filters = NonNullable<ReturnType<typeof readFilters>>;

function cohort(db: D1Database, sql: string, { from, to, source }: Filters) {
  return db.prepare(sql).bind(from, to, source, source);
}

const eligiblePixel = "v.eligible = 1 AND p.position IS NOT NULL AND p.created >= v.arrived_at";
const cohortJoin = `FROM campaign_visitors v
  LEFT JOIN relay_pixels p ON p.browser = v.browser
  WHERE v.arrived_at >= ? AND v.arrived_at < ? AND (? = '' OR v.source = ?)`;
const metrics = `COUNT(*) AS visits,
  COUNT(CASE WHEN v.eligible = 1 THEN 1 END) AS eligible,
  COUNT(CASE WHEN v.eligible = 1 THEN v.clicked_at END) AS clicks,
  COUNT(CASE WHEN ${eligiblePixel} THEN 1 END) AS lights,
  COUNT(CASE WHEN ${eligiblePixel} AND p.mexc_uid IS NOT NULL THEN 1 END) AS uid_records,
  COUNT(DISTINCT CASE WHEN ${eligiblePixel} THEN p.mexc_uid END) AS unique_uids,
  COUNT(CASE WHEN ${eligiblePixel} AND v.source = 'relay' THEN 1 END) AS relay_lights,
  COUNT(CASE WHEN v.eligible = 1 AND v.source = 'relay' THEN 1 END) AS relay_eligible`;

type MetricRow = {
  visits: number;
  eligible: number;
  clicks: number;
  lights: number;
  uid_records: number;
  unique_uids: number;
  relay_lights: number;
  relay_eligible: number;
};
type ChannelRow = MetricRow & { source: Channel };

export async function analyticsReport(db: D1Database, filters: Filters) {
  const [total, byChannel] = await db.batch<MetricRow | ChannelRow>([
    cohort(db, `SELECT ${metrics} ${cohortJoin}`, filters),
    cohort(db, `SELECT v.source, ${metrics} ${cohortJoin} GROUP BY v.source ORDER BY visits DESC, v.source`, filters),
  ]);
  return { total: total.results[0] as MetricRow, channels: byChannel.results as ChannelRow[] };
}

export async function uidRows(db: D1Database, filters: Filters) {
  const query = cohort(db, `WITH filtered AS (
    SELECT p.mexc_uid AS uid, p.created, p.mexc_uid_at, v.source,
      ROW_NUMBER() OVER (PARTITION BY p.mexc_uid
        ORDER BY COALESCE(p.mexc_uid_at, p.created) DESC, p.position DESC) AS uid_rank
    ${cohortJoin} AND ${eligiblePixel} AND p.mexc_uid IS NOT NULL
  ) SELECT uid, created, mexc_uid_at, source FROM filtered WHERE uid_rank = 1 ORDER BY created, uid`, filters);
  return (await query.all<{ uid: string; created: number; mexc_uid_at: number | null; source: Channel }>()).results;
}

function rate(count: number, base: number) {
  return base ? (count * 100 / base).toFixed(2) : "";
}

export function channelCsv(report: Awaited<ReturnType<typeof analyticsReport>>) {
  return [
    ["source", "visits", "eligible_visits", "clicked", "click_rate_pct", "lit", "light_conversion_pct", "uid_records", "unique_uids", "uid_fill_rate_pct", "relay_eligible", "relay_lit", "relay_conversion_pct"],
    ...[{ source: "total", ...report.total }, ...report.channels].map(row => [
      row.source, row.visits, row.eligible, row.clicks, rate(row.clicks, row.eligible), row.lights,
      rate(row.lights, row.eligible), row.uid_records, row.unique_uids, rate(row.uid_records, row.lights),
      row.relay_eligible, row.relay_lights, rate(row.relay_lights, row.relay_eligible),
    ]),
  ];
}
