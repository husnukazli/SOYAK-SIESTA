import type Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type {
  ApartmentSummary,
  AuthSession,
  ClosureReasonType,
  CourtClosureItem,
  PartnerFormat,
  PartnerPostItem,
  PartnerPostStatus,
  PartnerReplyItem,
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
let runtimeCipherKey: Buffer | null = null;

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
      // Ignore rollback failure
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
        password_encrypted TEXT,
        ban_until_ms BIGINT,
        ban_reason TEXT,
        created_at_ms BIGINT NOT NULL
      );

      ALTER TABLE apartments ADD COLUMN IF NOT EXISTS password_encrypted TEXT;

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

      CREATE TABLE IF NOT EXISTS partner_posts (
        id SERIAL PRIMARY KEY,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        skill_level INTEGER NOT NULL CHECK(skill_level BETWEEN 1 AND 7),
        session_format TEXT NOT NULL CHECK(session_format IN ('match', 'training', 'rally')),
        date_str TEXT NOT NULL,
        start_hour INTEGER NOT NULL,
        end_hour INTEGER NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'matched', 'closed')),
        created_at_ms BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_partner_posts_date_created
        ON partner_posts(date_str, created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS partner_replies (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES partner_posts(id) ON DELETE CASCADE,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at_ms BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_partner_replies_post_created
        ON partner_replies(post_id, created_at_ms ASC);

      CREATE TABLE IF NOT EXISTS court_closures (
        id SERIAL PRIMARY KEY,
        date_str TEXT NOT NULL,
        hour INTEGER NOT NULL,
        reason_type TEXT NOT NULL CHECK(reason_type IN ('maintenance', 'event', 'other')),
        reason_text TEXT NOT NULL,
        created_at_ms BIGINT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_court_closures_date_hour
        ON court_closures(date_str, hour);
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
        password_encrypted TEXT,
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

      CREATE TABLE IF NOT EXISTS partner_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        skill_level INTEGER NOT NULL CHECK(skill_level BETWEEN 1 AND 7),
        session_format TEXT NOT NULL CHECK(session_format IN ('match', 'training', 'rally')),
        date_str TEXT NOT NULL,
        start_hour INTEGER NOT NULL,
        end_hour INTEGER NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'matched', 'closed')),
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_partner_posts_date_created
        ON partner_posts(date_str, created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS partner_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES partner_posts(id) ON DELETE CASCADE,
        apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_partner_replies_post_created
        ON partner_replies(post_id, created_at_ms ASC);

      CREATE TABLE IF NOT EXISTS court_closures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_str TEXT NOT NULL,
        hour INTEGER NOT NULL,
        reason_type TEXT NOT NULL CHECK(reason_type IN ('maintenance', 'event', 'other')),
        reason_text TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_court_closures_date_hour
        ON court_closures(date_str, hour);
    `);

    const cols = conn.prepare('PRAGMA table_info(apartments)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'password_encrypted')) {
      conn.exec('ALTER TABLE apartments ADD COLUMN password_encrypted TEXT');
    }
  }

  // One-time cleanup: remove leftover pre-seeded numeric apartments (1..20) that do NOT have a password assigned
  const cleanupDone = await db.queryOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'cleaned_default_seed_v1'"
  );
  if (!cleanupDone) {
    const defaultIds = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const placeholders = defaultIds.map(() => '?').join(',');
    await db.execute(
      `DELETE FROM apartments WHERE apartment_no IN (${placeholders}) AND password_hash IS NULL`,
      defaultIds
    );
    if (isPostgres) {
      await db.execute(
        "INSERT INTO settings (key, value) VALUES ('cleaned_default_seed_v1', '1') ON CONFLICT (key) DO NOTHING"
      );
    } else {
      await db.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('cleaned_default_seed_v1', '1')"
      );
    }
  }

  // Initialize passcode recovery encryption key:
  // Prefer PASSCODE_ENCRYPTION_KEY or SESSION_SECRET from env; otherwise persist a generated key in settings
  const envCipherSecret =
    process.env.PASSCODE_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET?.trim();
  if (envCipherSecret && envCipherSecret.length >= 16) {
    runtimeCipherKey = crypto.createHash('sha256').update(envCipherSecret).digest();
  } else {
    const existingKeyRow = await db.queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'passcode_cipher_key'"
    );
    if (existingKeyRow?.value) {
      runtimeCipherKey = Buffer.from(existingKeyRow.value, 'hex');
    } else {
      const generatedHex = crypto.randomBytes(32).toString('hex');
      if (isPostgres) {
        await db.execute(
          "INSERT INTO settings (key, value) VALUES ('passcode_cipher_key', ?) ON CONFLICT (key) DO NOTHING",
          [generatedHex]
        );
      } else {
        await db.execute(
          "INSERT OR IGNORE INTO settings (key, value) VALUES ('passcode_cipher_key', ?)",
          [generatedHex]
        );
      }
      const row = await db.queryOne<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'passcode_cipher_key'"
      );
      runtimeCipherKey = Buffer.from(row?.value || generatedHex, 'hex');
    }
  }
}

// Session signing secret: use process.env.SESSION_SECRET when provided, else ephemeral CSPRNG secret
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

export function encryptPasscodeForAdmin(plainPasscode: string): string {
  if (!runtimeCipherKey) {
    throw new Error('Şifreleme anahtarı başlatılmadı.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', runtimeCipherKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainPasscode, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPasscodeForAdmin(stored: string | null | undefined): string | null {
  if (!stored || !runtimeCipherKey) return null;
  const parts = stored.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', runtimeCipherKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

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

export function signSessionToken(
  payload: Omit<TokenPayload, 'exp'>,
  ttlMs: number = 12 * 60 * 60 * 1000
): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
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

export interface RawCourtClosureRow {
  id: number | string;
  date_str: string;
  hour: number | string;
  reason_type: ClosureReasonType;
  reason_text: string;
  created_at_ms: number | string;
}

export function mapCourtClosureRow(row: RawCourtClosureRow): CourtClosureItem {
  return {
    id: Number(row.id),
    dateStr: row.date_str,
    hour: Number(row.hour),
    reasonType: row.reason_type,
    reasonText: row.reason_text,
    createdAtMs: Number(row.created_at_ms),
  };
}

export interface RawPartnerPostRow {
  id: number | string;
  apartment_no: string;
  nickname: string;
  skill_level: number | string;
  session_format: PartnerFormat;
  date_str: string;
  start_hour: number | string;
  end_hour: number | string;
  note: string | null;
  status: PartnerPostStatus;
  created_at_ms: number | string;
}

export interface RawPartnerReplyRow {
  id: number | string;
  post_id: number | string;
  apartment_no: string;
  nickname: string;
  message: string;
  created_at_ms: number | string;
}

export function mapPartnerReplyRow(
  row: RawPartnerReplyRow,
  viewerApartmentNo: string | null
): PartnerReplyItem {
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    nickname: row.nickname,
    message: row.message,
    createdAtMs: Number(row.created_at_ms),
    isOwn: Boolean(viewerApartmentNo && viewerApartmentNo === row.apartment_no),
  };
}

export function mapPartnerPostRow(
  row: RawPartnerPostRow,
  viewerApartmentNo: string | null,
  replies: PartnerReplyItem[]
): PartnerPostItem {
  return {
    id: Number(row.id),
    nickname: row.nickname,
    skillLevel: Number(row.skill_level),
    sessionFormat: row.session_format,
    dateStr: row.date_str,
    startHour: Number(row.start_hour),
    endHour: Number(row.end_hour),
    note: row.note,
    status: row.status,
    createdAtMs: Number(row.created_at_ms),
    isOwn: Boolean(viewerApartmentNo && viewerApartmentNo === row.apartment_no),
    replies,
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
  nowMs: number = Date.now(),
  options: { includePasscodes?: boolean } = {}
): Promise<ApartmentSummary[]> {
  const cutoff15d = nowMs - LATE_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const aptRows = await db.queryAll<{
    apartment_no: string;
    resident_label: string;
    password_hash: string | null;
    password_encrypted: string | null;
    ban_until_ms: number | string | null;
    ban_reason: string | null;
  }>(
    'SELECT apartment_no, resident_label, password_hash, password_encrypted, ban_until_ms, ban_reason FROM apartments'
  );

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
        ...(options.includePasscodes
          ? { visiblePasscode: decryptPasscodeForAdmin(aptRow.password_encrypted) }
          : {}),
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
