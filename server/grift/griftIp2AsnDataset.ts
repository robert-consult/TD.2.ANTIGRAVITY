import fs from "fs";
import path from "path";
import readline from "readline";
import net from "net";
import type Database from "better-sqlite3";

type Ip2AsnLookup = {
  asn: number | null;
  org: string | null;
  country: string | null;
  source: "ip2asn";
};

type Ip2AsnImportResult = {
  imported: boolean;
  skipped: boolean;
  reason?: string;
  filePath?: string;
  rows?: number;
  ipv4Rows?: number;
  ipv6Rows?: number;
  importedAt?: number;
};

function normalizeIpKey(input: string | null | undefined): string | null {
  if (!input) return null;
  let ip = String(input).trim();
  if (!ip) return null;
  if (ip.includes(",")) ip = ip.split(",")[0]!.trim();
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket?.[1]) ip = bracket[1];
  const ipv4Port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4Port?.[1]) ip = ipv4Port[1];
  return ip.trim().toLowerCase() || null;
}

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return a * 16777216 + b * 65536 + c * 256 + d;
}

function ipv6ToHex(ip: string): string | null {
  let input = ip.trim().toLowerCase();
  if (!input) return null;
  const bracket = input.match(/^\[([^\]]+)\]$/);
  if (bracket?.[1]) input = bracket[1];
  const zoneIdx = input.indexOf("%");
  if (zoneIdx >= 0) input = input.slice(0, zoneIdx);

  // Embedded IPv4 (last 32 bits)
  let embeddedIpv4: string | null = null;
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon >= 0) {
      embeddedIpv4 = input.slice(lastColon + 1);
      input = input.slice(0, lastColon) + ":ipv4";
    } else {
      embeddedIpv4 = input;
      input = "ipv4";
    }
  }

  const parts = input.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(":").filter(Boolean) : [];

  const groups: number[] = [];
  const pushGroup = (token: string) => {
    if (!token) return false;
    if (token === "ipv4") {
      if (!embeddedIpv4) return false;
      const ipv4Int = ipv4ToInt(embeddedIpv4);
      if (ipv4Int == null) return false;
      groups.push((ipv4Int >>> 16) & 0xffff);
      groups.push(ipv4Int & 0xffff);
      return true;
    }
    const n = parseInt(token, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xffff) return false;
    groups.push(n);
    return true;
  };

  for (const t of left) {
    if (!pushGroup(t)) return null;
  }

  const rightGroups: number[] = [];
  for (const t of right) {
    if (!t) continue;
    if (t === "ipv4") {
      if (!embeddedIpv4) return null;
      const ipv4Int = ipv4ToInt(embeddedIpv4);
      if (ipv4Int == null) return null;
      rightGroups.push((ipv4Int >>> 16) & 0xffff);
      rightGroups.push(ipv4Int & 0xffff);
      continue;
    }
    const n = parseInt(t, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xffff) return null;
    rightGroups.push(n);
  }

  const total = groups.length + rightGroups.length;
  if (total > 8) return null;

  const missing = 8 - total;
  if (parts.length === 2) {
    for (let i = 0; i < missing; i++) groups.push(0);
  } else if (missing !== 0) {
    // No '::' and not exactly 8 groups.
    return null;
  }

  groups.push(...rightGroups);
  if (groups.length !== 8) return null;

  return groups.map((g) => g.toString(16).padStart(4, "0")).join("");
}

export function getIp2AsnDatasetPath(): string | null {
  const fromEnv = process.env.GRIFT_IP2ASN_TSV_PATH;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  const defaultPath = path.resolve(process.cwd(), "attached_assets", "ip2asn-combined.tsv");
  return defaultPath;
}

function getMeta(db: Database.Database): any | null {
  try {
    return (
      db
        .prepare(
          `
          SELECT *
          FROM grift_ip_asn_dataset_meta
          WHERE id = 1
        `
        )
        .get() ?? null
    );
  } catch {
    return null;
  }
}

function isRangeTablePopulated(db: Database.Database): boolean {
  try {
    const row = db.prepare(`SELECT 1 as ok FROM grift_ip_asn_ranges LIMIT 1`).get() as any;
    return !!row?.ok;
  } catch {
    return false;
  }
}

export function lookupIp2Asn(db: Database.Database, ipRaw: string): Ip2AsnLookup | null {
  const ip = normalizeIpKey(ipRaw);
  if (!ip) return null;
  const version = net.isIP(ip);
  if (version !== 4 && version !== 6) return null;

  try {
    if (version === 4) {
      const ipInt = ipv4ToInt(ip);
      if (ipInt == null) return null;
      const row = db
        .prepare(
          `
          SELECT asn, org, country
          FROM grift_ip_asn_ranges
          WHERE ip_version = 4
            AND start_int <= ?
            AND end_int >= ?
          ORDER BY start_int DESC
          LIMIT 1
        `
        )
        .get(ipInt, ipInt) as any;
      const asn = typeof row?.asn === "number" ? row.asn : null;
      const org = typeof row?.org === "string" ? row.org : null;
      const country = typeof row?.country === "string" ? row.country : null;
      if (!asn && !org) return null;
      if (asn != null && asn <= 0) return null;
      if (org && org.toLowerCase() === "not routed") return null;
      return { asn, org, country, source: "ip2asn" };
    }

    const ipHex = ipv6ToHex(ip);
    if (!ipHex) return null;
    const row = db
      .prepare(
        `
        SELECT asn, org, country
        FROM grift_ip_asn_ranges
        WHERE ip_version = 6
          AND start_hex <= ?
          AND end_hex >= ?
        ORDER BY start_hex DESC
        LIMIT 1
      `
      )
      .get(ipHex, ipHex) as any;
    const asn = typeof row?.asn === "number" ? row.asn : null;
    const org = typeof row?.org === "string" ? row.org : null;
    const country = typeof row?.country === "string" ? row.country : null;
    if (!asn && !org) return null;
    if (asn != null && asn <= 0) return null;
    if (org && org.toLowerCase() === "not routed") return null;
    return { asn, org, country, source: "ip2asn" };
  } catch {
    return null;
  }
}

export async function maybeImportIp2AsnDataset(
  db: Database.Database,
  opts?: { filePath?: string; force?: boolean; batchSize?: number; logEvery?: number }
): Promise<Ip2AsnImportResult> {
  const filePath = path.resolve(opts?.filePath ?? getIp2AsnDatasetPath() ?? "");
  if (!filePath || !fs.existsSync(filePath)) {
    return { imported: false, skipped: true, reason: "Dataset TSV not found", filePath };
  }

  const stat = fs.statSync(filePath);
  const meta = getMeta(db);
  const already =
    !opts?.force &&
    meta &&
    meta.file_path === filePath &&
    Number(meta.file_mtime_ms) === Number(stat.mtimeMs) &&
    Number(meta.file_size) === Number(stat.size) &&
    isRangeTablePopulated(db);
  if (already) {
    return {
      imported: false,
      skipped: true,
      reason: "Dataset already imported",
      filePath,
      rows: Number(meta.row_count ?? 0),
      ipv4Rows: Number(meta.ipv4_count ?? 0),
      ipv6Rows: Number(meta.ipv6_count ?? 0),
      importedAt: Number(meta.imported_at ?? 0),
    };
  }

  const now = Date.now();
  const batchSize = Math.max(500, Math.min(50_000, Number(opts?.batchSize ?? 10_000)));
  const logEvery = Math.max(10_000, Math.min(500_000, Number(opts?.logEvery ?? 100_000)));

  db.exec(`DELETE FROM grift_ip_asn_ranges;`);
  db.exec(`DELETE FROM grift_ip_asn_dataset_meta;`);

  const insert = db.prepare(
    `
    INSERT INTO grift_ip_asn_ranges (
      ip_version, start_int, end_int, start_hex, end_hex, asn, country, org
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  );
  const insertBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      insert.run(r.ipVersion, r.startInt, r.endInt, r.startHex, r.endHex, r.asn, r.country, r.org);
    }
  });

  let rows = 0;
  let ipv4Rows = 0;
  let ipv6Rows = 0;
  let buffer: any[] = [];

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("\t");
      if (parts.length < 5) continue;

      const startIp = normalizeIpKey(parts[0]);
      const endIp = normalizeIpKey(parts[1]);
      const asnRaw = Number(parts[2]);
      const asn = Number.isFinite(asnRaw) ? Math.trunc(asnRaw) : 0;
      const country = parts[3] && parts[3] !== "None" ? parts[3] : null;
      const org = parts[4] && parts[4] !== "Not routed" ? parts[4] : null;

      if (!startIp || !endIp) continue;
      const vStart = net.isIP(startIp);
      const vEnd = net.isIP(endIp);
      if (vStart !== vEnd || (vStart !== 4 && vStart !== 6)) continue;

      if (vStart === 4) {
        const s = ipv4ToInt(startIp);
        const e = ipv4ToInt(endIp);
        if (s == null || e == null) continue;
        buffer.push({
          ipVersion: 4,
          startInt: s,
          endInt: e,
          startHex: null,
          endHex: null,
          asn,
          country,
          org,
        });
        ipv4Rows++;
      } else {
        const s = ipv6ToHex(startIp);
        const e = ipv6ToHex(endIp);
        if (!s || !e) continue;
        buffer.push({
          ipVersion: 6,
          startInt: null,
          endInt: null,
          startHex: s,
          endHex: e,
          asn,
          country,
          org,
        });
        ipv6Rows++;
      }

      rows++;
      if (buffer.length >= batchSize) {
        insertBatch(buffer);
        buffer = [];
      }

      if (rows > 0 && rows % logEvery === 0) {
        console.log(`[Grift] ip2asn import progress: ${rows} rows...`);
      }
    }

    if (buffer.length) {
      insertBatch(buffer);
      buffer = [];
    }

    db.prepare(
      `
      INSERT INTO grift_ip_asn_dataset_meta (
        id, file_path, file_mtime_ms, file_size, imported_at, row_count, ipv4_count, ipv6_count
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(filePath, Math.trunc(stat.mtimeMs), stat.size, now, rows, ipv4Rows, ipv6Rows);

    console.log(
      `[Grift] ip2asn import complete: ${rows} rows (v4=${ipv4Rows}, v6=${ipv6Rows}) from ${path.basename(filePath)}`
    );

    return {
      imported: true,
      skipped: false,
      filePath,
      rows,
      ipv4Rows,
      ipv6Rows,
      importedAt: now,
    };
  } finally {
    rl.close();
  }
}

