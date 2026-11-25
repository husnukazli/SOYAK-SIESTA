import type Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type {
  ApartmentSummary,
  AuthSession,
  PenaltyItem,
  PlayType,
  ReservationItem,
} from '../shared/types.ts';
import {
  getIstanbulClock,
  LATE_CANCEL_WINDOW_DAYS,
  PRIME_HOURS,
  shiftDateStr,
} from './rules.ts';

export interface DbExecutor {
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  insertReturningId(sql: string, params?: unknown[]): Promise<number>;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
export const isPostgres = Boolean(databaseUrl);

let pgPool: Pool | null = null;
let sqliteDb: Database.Database | null = null;
let sqliteTxMutex: Promise<void> = Promise.resolve();

function toPgPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

function shouldUsePgSsl(connStr: string): boolean | { rejectUnauthorized: boolean } {
  if (process.env.PGSSLMODE === 'disable' || process.env.DATABASE_SSL === 'false') {
    return false;
  }
  if (connStr.includes('localhost') || connStr.includes('127.0.0.1')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUsePgSsl(databaseUrl!),
      max: 10,
      connectionTimeoutMillis: 15_000,
    });
    pgPool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }
  return pgPool;
}

function getSqliteDb(): Database.Database {
  if (!sqliteDb) {
    throw new Error('SQLite veritabanı başlatılmadı. Önce initDatabase() çağrılmalıdır.');
  }
  return sqliteDb;
}

function makePgExecutor(querier: { query: Pool['query'] }): DbExecutor {
  return {
    async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await querier.query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const res = await querier.query(toPgPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const res = await querier.query(toPgPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async insertReturningId(sql: string, params: unknown[] = []): Promise<number> {
      const res = await querier.query(`${toPgPlaceholders(sql)} RETURNING id`, params);
      return Number(res.rows[0]?.id);
    },
  };
}

function makeSqliteExecutor(dbConn: Database.Database): DbExecutor {
  return {
    async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return dbConn.prepare(sql).all(...params) as T[];
    },
    async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      return dbConn.prepare(sql).get(...params) as T | undefined;
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const info = dbConn.prepare(sql).run(...params);
      return { changes: info.changes };
    },
    async insertReturningId(sql: string, params: unknown[] = []): Promise<number> {
      const info = dbConn.prepare(sql).run(...params);
      return Number(info.lastInsertRowid);
    },
  };
}

export const db: DbExecutor = {
  queryAll: (sql, params) =>
    isPostgres
      ? makePgExecutor(getPgPool()).queryAll(sql, params)
      : makeSqliteExecutor(getSqliteDb()).queryAll(sql, params),
  queryOne: (sql, params) =>
    isPostgres
      ? makePgExecutor(getPgPool()).queryOne(sql, params)
      : makeSqliteExecutor(getSqliteDb()).queryOne(sql, params),
  execute: (sql, params) =>
    isPostgres
      ? makePgExecutor(getPgPool()).execute(sql, params)
      : makeSqliteExecutor(getSqliteDb()).execute(sql, params),
  insertReturningId: (sql, params) =>
    isPostgres
      ? makePgExecutor(getPgPool()).insertReturningId(sql, params)
      : makeSqliteExecutor(getSqliteDb()).insertReturningId(sql, params),
};

export async function withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  if (isPostgres) {
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(makePgExecutor(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Serialize async SQLite transactions on the single local connection
  let release!: () => void;
  const prev = sqliteTxMutex;
  sqliteTxMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;

  const conn = getSqliteDb();
  try {
    conn.exec('BEGIN IMMEDIATE');
    const result = await fn(makeSqliteExecutor(conn));
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure if not in transaction
    }
    throw err;
  } finally {
    release();
  }
}

export async function initDatabase(): Promise<void> {
  if (isPostgres) {
    const pool = getPgPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS apartments (
        apartment_no TEXT PRIMARY KEY,
        resident_label TEXT NOT NULL,
        password_hash TEXT,
        ban_until_ms BIGINT,
        ban_reason TEXT,
        created_at_ms BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        date_str TEXT NOT NULL,
        hour INTEGER NOT NULL,
        start_ms BIGINT NOT NULL,
        end_ms BIGINT NOT NULL,
        play_type TEXT NOT NULL CHECK(play_type IN ('match', 'solo_training')),
        status TEXT NOT NULL CHECK(status IN ('active', 'cancelled_ontime', 'cancelled_late')),
        created_at_ms BIGINT NOT NULL,
        cancelled_at_ms BIGINT,
        late_cancel INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot
        ON reservations(date_str, hour)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS idx_reservations_apt_date
        ON reservations(apartment_no, date_str, status);

      CREATE TABLE IF NOT EXISTS penalties (
        id SERIAL PRIMARY KEY,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('late_cancellation', 'non_resident_violation')),
        action TEXT NOT NULL CHECK(action IN ('warning', 'ban_7d', 'ban_30d')),
        reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
        note TEXT NOT NULL,
        fee_amount TEXT,
        created_at_ms BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_penalties_apt_created
        ON penalties(apartment_no, created_at_ms);
    `);
  } else {
    if (!sqliteDb) {
      const { default: BetterSqlite3 } = await import('better-sqlite3');
      const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR?.trim() || 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const dbPath = path.join(dataDir, 'kort.db');
      sqliteDb = new BetterSqlite3(dbPath);
      sqliteDb.pragma('journal_mode = WAL');
      sqliteDb.pragma('foreign_keys = ON');
    }
    const conn = getSqliteDb();
    conn.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS apartments (
        apartment_no TEXT PRIMARY KEY,
        resident_label TEXT NOT NULL,
        password_hash TEXT,
        ban_until_ms INTEGER,
        ban_reason TEXT,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        date_str TEXT NOT NULL,
        hour INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        play_type TEXT NOT NULL CHECK(play_type IN ('match', 'solo_training')),
        status TEXT NOT NULL CHECK(status IN ('active', 'cancelled_ontime', 'cancelled_late')),
        created_at_ms INTEGER NOT NULL,
        cancelled_at_ms INTEGER,
        late_cancel INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot
        ON reservations(date_str, hour)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS idx_reservations_apt_date
        ON reservations(apartment_no, date_str, status);

      CREATE TABLE IF NOT EXISTS penalties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('late_cancellation', 'non_resident_violation')),
        action TEXT NOT NULL CHECK(action IN ('warning', 'ban_7d', 'ban_30d')),
        reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
        note TEXT NOT NULL,
        fee_amount TEXT,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_penalties_apt_created
        ON penalties(apartment_no, created_at_ms);
    `);
  }

  // Seed initial residential unit directory (Daire 1..20) without preset passcodes
  const countRow = await db.queryOne<{ cnt: string | number }>(
    'SELECT COUNT(*) as cnt FROM apartments'
  );
  if (Number(countRow?.cnt ?? 0) === 0) {
    const now = Date.now();
    await withTransaction(async (tx) => {
      for (let i = 1; i <= 20; i++) {
        await tx.execute(
          'INSERT INTO apartments (apartment_no, resident_label, password_hash, ban_until_ms, ban_reason, created_at_ms) VALUES (?, ?, NULL, NULL, NULL, ?)',
          [String(i), `Daire ${i}`, now]
        );
      }
    });
  }
}

// Session signing secret: use process.env.SESSION_SECRET when provided, else ephemeral CSPRNG secret
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasscodeHash(passcode: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexKey] = parts;
  if (!salt || !hexKey) return false;
  try {
    const derived = crypto.scryptSync(passcode, salt, 64);
    const storedBuf = Buffer.from(hexKey, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function generateReadablePasscode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code;
}

interface TokenPayload {
  role: 'resident' | 'admin';
  apartmentNo?: string;
  exp: number;
}

export function signSessionToken(payload: Omit<TokenPayload, 'exp'>): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): Omit<AuthSession, 'token'> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  if (!constantTimeEqualStrings(sig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return null;
    }
    if (parsed.role === 'admin') {
      return { role: 'admin' };
    }
    if (parsed.role === 'resident' && typeof parsed.apartmentNo === 'string' && parsed.apartmentNo) {
      return { role: 'resident', apartmentNo: parsed.apartmentNo };
    }
    return null;
  } catch {
    return null;
  }
}

export function getEnvAdminPasscode(): string | null {
  const val = process.env.ADMIN_PASSCODE?.trim();
  return val && val.length > 0 ? val : null;
}

export async function getStoredAdminHash(): Promise<string | null> {
  const row = await db.queryOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'admin_passcode_hash'"
  );
  return row ? row.value : null;
}

export async function isAdminSetupNeeded(): Promise<boolean> {
  if (getEnvAdminPasscode()) return false;
  return !(await getStoredAdminHash());
}

export async function claimAdminPasscodeHash(hash: string): Promise<boolean> {
  if (isPostgres) {
    const res = await db.execute(
      "INSERT INTO settings (key, value) VALUES ('admin_passcode_hash', ?) ON CONFLICT (key) DO NOTHING",
      [hash]
    );
    return res.changes > 0;
  }
  const res = await db.execute(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_passcode_hash', ?)",
    [hash]
  );
  return res.changes > 0;
}

export interface RawReservationRow {
  id: number | string;
  apartment_no: string;
  date_str: string;
  hour: number | string;
  start_ms: number | string;
  end_ms: number | string;
  play_type: PlayType;
  status: 'active' | 'cancelled_ontime' | 'cancelled_late';
  created_at_ms: number | string;
  cancelled_at_ms: number | string | null;
  late_cancel: number | string;
}

export interface RawPenaltyRow {
  id: number | string;
  apartment_no: string;
  type: 'late_cancellation' | 'non_resident_violation';
  action: 'warning' | 'ban_7d' | 'ban_30d';
  reservation_id: number | string | null;
  note: string;
  fee_amount: string | null;
  created_at_ms: number | string;
}

export function mapReservationRow(row: RawReservationRow): ReservationItem {
  return {
    id: Number(row.id),
    apartmentNo: row.apartment_no,
    dateStr: row.date_str,
    hour: Number(row.hour),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    playType: row.play_type,
    status: row.status,
    createdAtMs: Number(row.created_at_ms),
    cancelledAtMs: row.cancelled_at_ms !== null ? Number(row.cancelled_at_ms) : null,
    lateCancel: Number(row.late_cancel) === 1,
  };
}

export function mapPenaltyRow(row: RawPenaltyRow): PenaltyItem {
  return {
    id: Number(row.id),
    apartmentNo: row.apartment_no,
    type: row.type,
    action: row.action,
    reservationId: row.reservation_id !== null ? Number(row.reservation_id) : null,
    note: row.note,
    feeAmount: row.fee_amount,
    createdAtMs: Number(row.created_at_ms),
  };
}

export async function getApartmentSummary(
  apartmentNo: string,
  nowMs: number = Date.now(),
  executor: DbExecutor = db
): Promise<ApartmentSummary | null> {
  const aptRow = await executor.queryOne<{
    apartment_no: string;
    resident_label: string;
    password_hash: string | null;
    ban_until_ms: number | string | null;
    ban_reason: string | null;
  }>(
    'SELECT apartment_no, resident_label, password_hash, ban_until_ms, ban_reason FROM apartments WHERE apartment_no = ?',
    [apartmentNo]
  );

  if (!aptRow) return null;

  const cutoff15d = nowMs - LATE_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lateCancelRow = await executor.queryOne<{ cnt: number | string }>(
    "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'late_cancellation' AND created_at_ms >= ?",
    [apartmentNo, cutoff15d]
  );

  const violationRow = await executor.queryOne<{ cnt: number | string }>(
    "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'non_resident_violation'",
    [apartmentNo]
  );

  const activeResRow = await executor.queryOne<RawReservationRow>(
    "SELECT * FROM reservations WHERE apartment_no = ? AND status = 'active' AND end_ms > ? ORDER BY start_ms ASC LIMIT 1",
    [apartmentNo, nowMs]
  );

  const banMs = aptRow.ban_until_ms !== null ? Number(aptRow.ban_until_ms) : null;
  const activeBanUntil = banMs && banMs > nowMs ? banMs : null;

  return {
    apartmentNo: aptRow.apartment_no,
    residentLabel: aptRow.resident_label,
    hasPassword: Boolean(aptRow.password_hash),
    banUntilMs: activeBanUntil,
    banReason: activeBanUntil ? aptRow.ban_reason : null,
    lateCancelsLast15d: Number(lateCancelRow?.cnt ?? 0),
    nonResidentViolations: Number(violationRow?.cnt ?? 0),
    activeReservation: activeResRow ? mapReservationRow(activeResRow) : null,
  };
}

export async function getApartmentRuleContext(
  apartmentNo: string,
  targetDateStr: string,
  nowMs: number,
  executor: DbExecutor = db
) {
  const apt = await getApartmentSummary(apartmentNo, nowMs, executor);
  if (!apt) return null;

  const hasActiveUnfinishedBooking = Boolean(apt.activeReservation);

  const sameDayRow = await executor.queryOne<{ cnt: number | string }>(
    "SELECT COUNT(*) as cnt FROM reservations WHERE apartment_no = ? AND date_str = ? AND status = 'active'",
    [apartmentNo, targetDateStr]
  );

  const prevDateStr = shiftDateStr(targetDateStr, -1);
  const nextDateStr = shiftDateStr(targetDateStr, 1);
  const primeHoursList = Array.from(PRIME_HOURS);
  const placeholders = primeHoursList.map(() => '?').join(',');

  const adjPrimeRow = await executor.queryOne<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM reservations WHERE apartment_no = ? AND status = 'active' AND date_str IN (?, ?) AND hour IN (${placeholders})`,
    [apartmentNo, prevDateStr, nextDateStr, ...primeHoursList]
  );

  return {
    apartmentNo,
    banUntilMs: apt.banUntilMs,
    banReason: apt.banReason,
    hasActiveUnfinishedBooking,
    hasSameDayBooking: Number(sameDayRow?.cnt ?? 0) > 0,
    hasAdjacentDayPrimeBooking: Number(adjPrimeRow?.cnt ?? 0) > 0,
    summary: apt,
  };
}

export function sortApartmentNumbers(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
    return numA - numB;
  }
  return a.localeCompare(b, 'tr');
}

export async function getAllApartmentSummaries(
  nowMs: number = Date.now()
): Promise<ApartmentSummary[]> {
  const cutoff15d = nowMs - LATE_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const aptRows = await db.queryAll<{
    apartment_no: string;
    resident_label: string;
    password_hash: string | null;
    ban_until_ms: number | string | null;
    ban_reason: string | null;
  }>('SELECT apartment_no, resident_label, password_hash, ban_until_ms, ban_reason FROM apartments');

  const lateCounts = await db.queryAll<{ apartment_no: string; cnt: number | string }>(
    "SELECT apartment_no, COUNT(*) as cnt FROM penalties WHERE type = 'late_cancellation' AND created_at_ms >= ? GROUP BY apartment_no",
    [cutoff15d]
  );
  const violationCounts = await db.queryAll<{ apartment_no: string; cnt: number | string }>(
    "SELECT apartment_no, COUNT(*) as cnt FROM penalties WHERE type = 'non_resident_violation' GROUP BY apartment_no"
  );
  const activeReservations = await db.queryAll<RawReservationRow>(
    "SELECT * FROM reservations WHERE status = 'active' AND end_ms > ? ORDER BY start_ms ASC",
    [nowMs]
  );

  const lateMap = new Map(lateCounts.map((r) => [r.apartment_no, Number(r.cnt)]));
  const violationMap = new Map(violationCounts.map((r) => [r.apartment_no, Number(r.cnt)]));
  const activeResMap = new Map<string, ReservationItem>();
  for (const row of activeReservations) {
    if (!activeResMap.has(row.apartment_no)) {
      activeResMap.set(row.apartment_no, mapReservationRow(row));
    }
  }

  return aptRows
    .sort((a, b) => sortApartmentNumbers(a.apartment_no, b.apartment_no))
    .map((aptRow) => {
      const banMs = aptRow.ban_until_ms !== null ? Number(aptRow.ban_until_ms) : null;
      const activeBanUntil = banMs && banMs > nowMs ? banMs : null;
      return {
        apartmentNo: aptRow.apartment_no,
        residentLabel: aptRow.resident_label,
        hasPassword: Boolean(aptRow.password_hash),
        banUntilMs: activeBanUntil,
        banReason: activeBanUntil ? aptRow.ban_reason : null,
        lateCancelsLast15d: lateMap.get(aptRow.apartment_no) ?? 0,
        nonResidentViolations: violationMap.get(aptRow.apartment_no) ?? 0,
        activeReservation: activeResMap.get(aptRow.apartment_no) ?? null,
      };
    });
}

export function getClockNow() {
  return getIstanbulClock(Date.now());
}
