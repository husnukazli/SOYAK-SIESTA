import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ApartmentSummary,
  AuthSession,
  PenaltyItem,
  PlayType,
  ReservationItem,
} from '../shared/types.js';
import {
  getIstanbulClock,
  LATE_CANCEL_WINDOW_DAYS,
  PRIME_HOURS,
  shiftDateStr,
} from './rules.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'kort.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

// Seed initial residential unit directory (Daire 1..20) without any preset passcodes.
// Management assigns or generates passcodes explicitly from the Yönetim panel.
const existingCountRow = db
  .prepare('SELECT COUNT(*) as cnt FROM apartments')
  .get() as { cnt: number };

if (existingCountRow.cnt === 0) {
  const insertApt = db.prepare(
    'INSERT INTO apartments (apartment_no, resident_label, password_hash, ban_until_ms, ban_reason, created_at_ms) VALUES (?, ?, NULL, NULL, NULL, ?)'
  );
  const now = Date.now();
  const seedTx = db.transaction(() => {
    for (let i = 1; i <= 20; i++) {
      insertApt.run(String(i), `Daire ${i}`, now);
    }
  });
  seedTx();
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
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12 hours
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

export function getStoredAdminHash(): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'admin_passcode_hash'")
    .get() as { value: string } | undefined;
  return row ? row.value : null;
}

export function isAdminSetupNeeded(): boolean {
  if (getEnvAdminPasscode()) return false;
  return !getStoredAdminHash();
}

export function mapReservationRow(row: {
  id: number;
  apartment_no: string;
  date_str: string;
  hour: number;
  start_ms: number;
  end_ms: number;
  play_type: PlayType;
  status: 'active' | 'cancelled_ontime' | 'cancelled_late';
  created_at_ms: number;
  cancelled_at_ms: number | null;
  late_cancel: number;
}): ReservationItem {
  return {
    id: row.id,
    apartmentNo: row.apartment_no,
    dateStr: row.date_str,
    hour: row.hour,
    startMs: row.start_ms,
    endMs: row.end_ms,
    playType: row.play_type,
    status: row.status,
    createdAtMs: row.created_at_ms,
    cancelledAtMs: row.cancelled_at_ms,
    lateCancel: row.late_cancel === 1,
  };
}

export function mapPenaltyRow(row: {
  id: number;
  apartment_no: string;
  type: 'late_cancellation' | 'non_resident_violation';
  action: 'warning' | 'ban_7d' | 'ban_30d';
  reservation_id: number | null;
  note: string;
  fee_amount: string | null;
  created_at_ms: number;
}): PenaltyItem {
  return {
    id: row.id,
    apartmentNo: row.apartment_no,
    type: row.type,
    action: row.action,
    reservationId: row.reservation_id,
    note: row.note,
    feeAmount: row.fee_amount,
    createdAtMs: row.created_at_ms,
  };
}

export function getApartmentSummary(apartmentNo: string, nowMs: number = Date.now()): ApartmentSummary | null {
  const aptRow = db
    .prepare(
      'SELECT apartment_no, resident_label, password_hash, ban_until_ms, ban_reason FROM apartments WHERE apartment_no = ?'
    )
    .get(apartmentNo) as
    | {
        apartment_no: string;
        resident_label: string;
        password_hash: string | null;
        ban_until_ms: number | null;
        ban_reason: string | null;
      }
    | undefined;

  if (!aptRow) return null;

  const cutoff15d = nowMs - LATE_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lateCancelRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'late_cancellation' AND created_at_ms >= ?"
    )
    .get(apartmentNo, cutoff15d) as { cnt: number };

  const violationRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'non_resident_violation'"
    )
    .get(apartmentNo) as { cnt: number };

  const activeResRow = db
    .prepare(
      "SELECT * FROM reservations WHERE apartment_no = ? AND status = 'active' AND end_ms > ? ORDER BY start_ms ASC LIMIT 1"
    )
    .get(apartmentNo, nowMs) as Parameters<typeof mapReservationRow>[0] | undefined;

  const activeBanUntil =
    aptRow.ban_until_ms && aptRow.ban_until_ms > nowMs ? aptRow.ban_until_ms : null;

  return {
    apartmentNo: aptRow.apartment_no,
    residentLabel: aptRow.resident_label,
    hasPassword: Boolean(aptRow.password_hash),
    banUntilMs: activeBanUntil,
    banReason: activeBanUntil ? aptRow.ban_reason : null,
    lateCancelsLast15d: lateCancelRow.cnt,
    nonResidentViolations: violationRow.cnt,
    activeReservation: activeResRow ? mapReservationRow(activeResRow) : null,
  };
}

export function getApartmentRuleContext(apartmentNo: string, targetDateStr: string, nowMs: number) {
  const apt = getApartmentSummary(apartmentNo, nowMs);
  if (!apt) return null;

  const hasActiveUnfinishedBooking = Boolean(apt.activeReservation);

  const sameDayRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM reservations WHERE apartment_no = ? AND date_str = ? AND status = 'active'"
    )
    .get(apartmentNo, targetDateStr) as { cnt: number };

  const prevDateStr = shiftDateStr(targetDateStr, -1);
  const nextDateStr = shiftDateStr(targetDateStr, 1);
  const primeHoursList = Array.from(PRIME_HOURS);
  const placeholders = primeHoursList.map(() => '?').join(',');

  const adjPrimeRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM reservations WHERE apartment_no = ? AND status = 'active' AND date_str IN (?, ?) AND hour IN (${placeholders})`
    )
    .get(apartmentNo, prevDateStr, nextDateStr, ...primeHoursList) as { cnt: number };

  return {
    apartmentNo,
    banUntilMs: apt.banUntilMs,
    banReason: apt.banReason,
    hasActiveUnfinishedBooking,
    hasSameDayBooking: sameDayRow.cnt > 0,
    hasAdjacentDayPrimeBooking: adjPrimeRow.cnt > 0,
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

export function getAllApartmentSummaries(nowMs: number = Date.now()): ApartmentSummary[] {
  const rows = db
    .prepare('SELECT apartment_no FROM apartments')
    .all() as { apartment_no: string }[];
  return rows
    .sort((a, b) => sortApartmentNumbers(a.apartment_no, b.apartment_no))
    .map((r) => getApartmentSummary(r.apartment_no, nowMs)!)
    .filter(Boolean);
}

export function getClockNow() {
  return getIstanbulClock(Date.now());
}
