import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  claimAdminPasscodeHash,
  constantTimeEqualStrings,
  db,
  decryptPasscodeForAdmin,
  encryptPasscodeForAdmin,
  generateReadablePasscode,
  getAllApartmentSummaries,
  getApartmentRuleContext,
  getApartmentSummary,
  getClockNow,
  getEnvAdminPasscode,
  getStoredAdminHash,
  hashPasscode,
  initDatabase,
  isAdminSetupNeeded,
  isPostgres,
  mapPartnerPostRow,
  mapPartnerReplyRow,
  mapPenaltyRow,
  mapReservationRow,
  parseCookies,
  type RawPartnerPostRow,
  type RawPartnerReplyRow,
  type RawPenaltyRow,
  type RawReservationRow,
  signSessionToken,
  sortApartmentNumbers,
  verifyPasscodeHash,
  verifySessionToken,
  withTransaction,
} from './src/server/db.ts';
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  evaluateSlotEligibility,
  FREE_CANCEL_HOURS,
  getIstanbulClock,
  getSlotBoundsMs,
  isPrimeHour,
  isValidDateStr,
  LATE_CANCEL_BAN_DAYS,
  LATE_CANCEL_WINDOW_DAYS,
  MAX_BOOKING_DAYS_AHEAD,
  pad2,
  shiftDateStr,
  VIOLATION_BAN_DAYS,
} from './src/server/rules.ts';
import {
  describeWmoCode,
  KARSIYAKA_OPEN_METEO_URL,
  parseOpenMeteoPayload,
} from './src/shared/weather.ts';
import type {
  AdminOverviewResponse,
  AuthSession,
  BackupApartmentRecord,
  BackupPartnerPostRecord,
  BackupPartnerReplyRecord,
  PartnerBoardResponse,
  PartnerFormat,
  PartnerPostStatus,
  PartnerReplyItem,
  PenaltyItem,
  PlayType,
  RealtimeEvent,
  ReservationItem,
  ResidentPortalResponse,
  ScheduleResponse,
  ScheduleSlot,
  SystemBackupPayload,
  WeatherDailyItem,
  WeatherHourlySlot,
  WeatherResponse,
} from './src/shared/types.ts';

interface AuthenticatedRequest extends Request {
  session?: Omit<AuthSession, 'token'>;
}

const RESIDENT_REMEMBER_COOKIE = 'soyak_resident_session';
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REMEMBER_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function buildRememberCookieHeader(value: string, maxAgeSec: number): string {
  return `${RESIDENT_REMEMBER_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${maxAgeSec}`;
}

function hasSameOriginOrAjaxHeader(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function parseBearerSession(req: Request): Omit<AuthSession, 'token'> | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  return verifySessionToken(token);
}

function requireAuth(role?: 'resident' | 'admin') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const session = parseBearerSession(req);
    if (!session) {
      res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.' });
      return;
    }
    if (role && session.role !== role) {
      res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmamaktadır.' });
      return;
    }
    req.session = session;
    next();
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const pgCode = 'code' in err ? (err as { code?: unknown }).code : undefined;
  if (pgCode === '23505') return true;
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) return true;
  return false;
}

async function startServer() {
  await initDatabase();
  console.log(`Database initialized (${isPostgres ? 'PostgreSQL' : 'SQLite local'})`);
  if (process.env.NODE_ENV === 'production' && !isPostgres) {
    console.warn(
      'UYARI: DATABASE_URL tanımlı olmadığı için geçici yerel SQLite kullanılıyor. Render güncellemelerinde veriler sıfırlanabilir; kalıcı kayıt için DATABASE_URL bağlayın.'
    );
  }

  const app = express();
  const standardJsonParser = express.json({ limit: '100kb' });
  const restoreJsonParser = express.json({ limit: '5mb' });
  app.use((req, res, next) => {
    if (req.path === '/api/admin/restore') {
      restoreJsonParser(req, res, next);
    } else {
      standardJsonParser(req, res, next);
    }
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const aliveMap = new WeakMap<WebSocket, boolean>();

  function broadcastEvent(event: RealtimeEvent) {
    const serialized = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  wss.on('connection', (ws) => {
    aliveMap.set(ws, true);
    ws.on('pong', () => {
      aliveMap.set(ws, true);
    });
    const welcome: RealtimeEvent = {
      type: 'connected',
      activeConnections: wss.clients.size,
      nowMs: Date.now(),
    };
    ws.send(JSON.stringify(welcome));
  });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (aliveMap.get(client) === false) {
        client.terminate();
        continue;
      }
      aliveMap.set(client, false);
      client.ping();
    }
  }, 30_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // Ultra-lightweight ping for uptime monitors (GET / HEAD)
  app.get('/api/ping', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Health check
  app.get('/api/health', async (_req, res) => {
    try {
      await db.queryOne('SELECT 1 as ok');
      res.json({ ok: true, database: isPostgres ? 'postgres' : 'sqlite' });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Auth status & apartment directory (never exposes password hashes)
  app.get('/api/auth/status', async (_req, res) => {
    try {
      const [setupNeeded, summaries] = await Promise.all([
        isAdminSetupNeeded(),
        getAllApartmentSummaries(),
      ]);
      const apartments = summaries.map((a) => ({
        apartmentNo: a.apartmentNo,
        residentLabel: a.residentLabel,
        hasPassword: a.hasPassword,
      }));
      res.json({
        adminSetupNeeded: setupNeeded,
        apartments,
      });
    } catch (err) {
      console.error('Auth status error:', err);
      res.status(500).json({ error: 'Durum bilgisi alınamadı.' });
    }
  });

  // Verify current Bearer session or restore remembered HttpOnly resident cookie session
  app.get('/api/auth/me', async (req, res) => {
    try {
      const bearer = parseBearerSession(req);
      if (bearer) {
        res.json({ session: bearer });
        return;
      }

      const cookies = parseCookies(req.headers.cookie);
      const cookieToken = cookies[RESIDENT_REMEMBER_COOKIE];
      if (!cookieToken) {
        res.status(401).json({ error: 'Aktif oturum bulunamadı.' });
        return;
      }

      const parsed = verifySessionToken(cookieToken);
      if (!parsed || parsed.role !== 'resident' || !parsed.apartmentNo) {
        res.setHeader('Set-Cookie', buildRememberCookieHeader('', 0));
        res.status(401).json({ error: 'Aktif oturum bulunamadı.' });
        return;
      }

      const row = await db.queryOne<{ apartment_no: string; password_hash: string | null }>(
        'SELECT apartment_no, password_hash FROM apartments WHERE apartment_no = ?',
        [parsed.apartmentNo]
      );
      if (!row || !row.password_hash) {
        res.setHeader('Set-Cookie', buildRememberCookieHeader('', 0));
        res.status(401).json({ error: 'Aktif oturum geçersiz.' });
        return;
      }

      res.json({ session: parsed, token: cookieToken });
    } catch (err) {
      console.error('Auth me error:', err);
      res.status(500).json({ error: 'Oturum doğrulanamadı.' });
    }
  });

  // Clear Remember Me resident cookie on explicit logout
  app.post('/api/auth/logout', (req, res) => {
    if (!hasSameOriginOrAjaxHeader(req)) {
      res.status(403).json({ error: 'Geçersiz istek kaynağı.' });
      return;
    }
    res.setHeader('Set-Cookie', buildRememberCookieHeader('', 0));
    res.json({ ok: true });
  });

  // One-time inline admin passcode setup when process.env.ADMIN_PASSCODE is unset
  app.post('/api/auth/admin/setup', async (req, res) => {
    try {
      if (getEnvAdminPasscode() || (await getStoredAdminHash())) {
        res.status(409).json({
          error: 'Yönetici şifresi zaten tanımlanmış. Lütfen giriş yapın.',
        });
        return;
      }
      const rawPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
      if (rawPasscode.length < 6 || rawPasscode.length > 64) {
        res.status(400).json({
          error: 'Yönetici şifresi en az 6, en fazla 64 karakter olmalıdır.',
        });
        return;
      }

      const hash = hashPasscode(rawPasscode);
      const claimed = await claimAdminPasscodeHash(hash);

      if (!claimed) {
        res.status(409).json({
          error: 'Yönetici şifresi zaten tanımlanmış.',
        });
        return;
      }

      const token = signSessionToken({ role: 'admin' });
      res.json({ token, role: 'admin' });
    } catch (err) {
      console.error('Admin setup error:', err);
      res.status(500).json({ error: 'Yönetici kurulumu sırasında hata oluştu.' });
    }
  });

  // Admin login
  app.post('/api/auth/admin/login', async (req, res) => {
    try {
      const rawPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
      if (!rawPasscode) {
        res.status(400).json({ error: 'Lütfen yönetici şifresini girin.' });
        return;
      }

      const envPasscode = getEnvAdminPasscode();
      let valid = false;
      if (envPasscode) {
        valid = constantTimeEqualStrings(rawPasscode, envPasscode);
      } else {
        const storedHash = await getStoredAdminHash();
        if (!storedHash) {
          res.status(400).json({ error: 'Henüz yönetici şifresi oluşturulmamış.' });
          return;
        }
        valid = verifyPasscodeHash(rawPasscode, storedHash);
      }

      if (!valid) {
        res.status(401).json({ error: 'Yönetici şifresi hatalı.' });
        return;
      }

      const token = signSessionToken({ role: 'admin' });
      res.json({ token, role: 'admin' });
    } catch (err) {
      console.error('Admin login error:', err);
      res.status(500).json({ error: 'Giriş sırasında hata oluştu.' });
    }
  });

  // Resident login by apartment number + assigned password (+ optional 30-day Remember Me cookie)
  app.post('/api/auth/resident/login', async (req, res) => {
    try {
      const apartmentNo =
        typeof req.body?.apartmentNo === 'string' ? req.body.apartmentNo.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
      const rememberMe = req.body?.rememberMe === true;

      if (!apartmentNo || !password) {
        res.status(400).json({ error: 'Daire numarası ve şifre gereklidir.' });
        return;
      }

      const row = await db.queryOne<{ apartment_no: string; password_hash: string | null }>(
        'SELECT apartment_no, password_hash FROM apartments WHERE apartment_no = ?',
        [apartmentNo]
      );

      if (!row) {
        res.status(401).json({ error: 'Daire numarası veya şifre hatalı.' });
        return;
      }

      if (!row.password_hash) {
        res.status(403).json({
          error:
            'Bu daireye henüz şifre tahsis edilmemiş. Lütfen site yönetiminden şifrenizi talep edin.',
        });
        return;
      }

      if (!verifyPasscodeHash(password, row.password_hash)) {
        res.status(401).json({ error: 'Daire numarası veya şifre hatalı.' });
        return;
      }

      const token = signSessionToken(
        { role: 'resident', apartmentNo: row.apartment_no },
        rememberMe ? REMEMBER_TTL_MS : undefined
      );

      if (rememberMe) {
        res.setHeader('Set-Cookie', buildRememberCookieHeader(token, REMEMBER_MAX_AGE_SEC));
      } else {
        res.setHeader('Set-Cookie', buildRememberCookieHeader('', 0));
      }

      res.json({ token, role: 'resident', apartmentNo: row.apartment_no });
    } catch (err) {
      console.error('Resident login error:', err);
      res.status(500).json({ error: 'Giriş sırasında hata oluştu.' });
    }
  });

  // Public + authenticated daily court schedule
  app.get('/api/schedule', async (req, res) => {
    try {
      const clock = getClockNow();
      const requestedDate =
        typeof req.query.date === 'string' && isValidDateStr(req.query.date)
          ? req.query.date
          : clock.dateStr;

      const minDate = clock.dateStr;
      const maxDate = shiftDateStr(clock.dateStr, MAX_BOOKING_DAYS_AHEAD);
      const dateStr =
        requestedDate < minDate || requestedDate > maxDate ? clock.dateStr : requestedDate;

      const session = parseBearerSession(req);
      const viewerAptNo = session?.role === 'resident' ? session.apartmentNo : null;
      const aptContext = viewerAptNo
        ? await getApartmentRuleContext(viewerAptNo, dateStr, clock.nowMs)
        : null;

      const dayReservations = await db.queryAll<RawReservationRow>(
        "SELECT * FROM reservations WHERE date_str = ? AND status = 'active'",
        [dateStr]
      );

      const byHour = new Map<number, ReturnType<typeof mapReservationRow>>();
      for (const row of dayReservations) {
        const mapped = mapReservationRow(row);
        byHour.set(mapped.hour, mapped);
      }

      const todayRows =
        dateStr === clock.dateStr
          ? dayReservations
          : await db.queryAll<RawReservationRow>(
              "SELECT * FROM reservations WHERE date_str = ? AND status = 'active'",
              [clock.dateStr]
            );
      const currentSlotRow = todayRows.find((r) => Number(r.hour) === clock.hour);
      const isOperational = clock.hour >= COURT_OPEN_HOUR && clock.hour < COURT_CLOSE_HOUR;

      const slots: ScheduleSlot[] = [];
      for (let h = COURT_OPEN_HOUR; h < COURT_CLOSE_HOUR; h++) {
        const { startMs, endMs } = getSlotBoundsMs(dateStr, h);
        const resItem = byHour.get(h) || null;
        const isPast = endMs <= clock.nowMs + 5 * 60 * 1000;
        const isCurrent = dateStr === clock.dateStr && h === clock.hour;

        const eligibility = aptContext
          ? evaluateSlotEligibility({
              clock,
              targetDateStr: dateStr,
              hour: h,
              slotReserved: Boolean(resItem),
              apt: aptContext,
            })
          : null;

        slots.push({
          hour: h,
          label: `${pad2(h)}:00 - ${pad2(h + 1)}:00`,
          primeTime: isPrimeHour(h),
          startMs,
          endMs,
          isPast,
          isCurrent,
          reservation: resItem
            ? {
                id: resItem.id,
                apartmentNo: resItem.apartmentNo,
                playType: resItem.playType,
                isOwn: viewerAptNo === resItem.apartmentNo,
              }
            : null,
          eligibility,
        });
      }

      const payload: ScheduleResponse = {
        dateStr,
        todayStr: clock.dateStr,
        nowMs: clock.nowMs,
        nowIstanbulLabel: clock.label,
        nowHour: clock.hour,
        courtStatus: {
          currentHour: clock.hour,
          currentHourLabel: isOperational
            ? `${pad2(clock.hour)}:00 - ${pad2(clock.hour + 1)}:00`
            : 'Kort Kapalı (07:00 - 23:00)',
          isOperational,
          reservedBy: currentSlotRow ? currentSlotRow.apartment_no : null,
          playType: currentSlotRow ? currentSlotRow.play_type : null,
          walkInAvailable: isOperational && !currentSlotRow,
        },
        slots,
        residentSummary: aptContext ? aptContext.summary : null,
      };

      res.json(payload);
    } catch (err) {
      console.error('Schedule fetch error:', err);
      res.status(500).json({ error: 'Kort programı yüklenemedi.' });
    }
  });

  // Resident personal portal (active booking, history, penalties)
  app.get('/api/resident/portal', requireAuth('resident'), async (req: AuthenticatedRequest, res) => {
    try {
      const apartmentNo = req.session!.apartmentNo!;
      const clock = getClockNow();
      const apartment = await getApartmentSummary(apartmentNo, clock.nowMs);
      if (!apartment) {
        res.status(404).json({ error: 'Daire kaydı bulunamadı.' });
        return;
      }

      const [reservationRows, penaltyRows] = await Promise.all([
        db.queryAll<RawReservationRow>(
          'SELECT * FROM reservations WHERE apartment_no = ? ORDER BY start_ms DESC LIMIT 50',
          [apartmentNo]
        ),
        db.queryAll<RawPenaltyRow>(
          'SELECT * FROM penalties WHERE apartment_no = ? ORDER BY created_at_ms DESC LIMIT 50',
          [apartmentNo]
        ),
      ]);

      const payload: ResidentPortalResponse = {
        apartment,
        reservations: reservationRows.map(mapReservationRow),
        penalties: penaltyRows.map(mapPenaltyRow),
        nowMs: clock.nowMs,
      };
      res.json(payload);
    } catch (err) {
      console.error('Resident portal error:', err);
      res.status(500).json({ error: 'Daire bilgileri yüklenemedi.' });
    }
  });

  // Create reservation (enforces all court regulation rules inside an atomic transaction)
  app.post('/api/reservations', requireAuth('resident'), async (req: AuthenticatedRequest, res) => {
    const apartmentNo = req.session!.apartmentNo!;
    const dateStr = typeof req.body?.dateStr === 'string' ? req.body.dateStr.trim() : '';
    const hour = Number(req.body?.hour);
    const playType: PlayType =
      req.body?.playType === 'solo_training' ? 'solo_training' : 'match';
    const residentConfirmed = req.body?.residentConfirmed === true;

    if (!isValidDateStr(dateStr)) {
      res.status(400).json({ error: 'Geçersiz tarih formatı.' });
      return;
    }
    if (!Number.isInteger(hour) || hour < COURT_OPEN_HOUR || hour >= COURT_CLOSE_HOUR) {
      res.status(400).json({ error: 'Geçersiz saat seçimi (07:00 - 23:00).' });
      return;
    }
    if (!residentConfirmed) {
      res.status(400).json({
        error:
          'Kortu kullanan kişilerden en az birinin ilgili daire sakini olduğunu onaylamanız gerekir.',
      });
      return;
    }

    const clock = getClockNow();

    try {
      const created = await withTransaction(async (tx) => {
        const aptCtx = await getApartmentRuleContext(apartmentNo, dateStr, clock.nowMs, tx);
        if (!aptCtx) {
          throw { status: 404, message: 'Daire kaydı bulunamadı.' };
        }

        const existingSlot = await tx.queryOne<{ id: number | string }>(
          "SELECT id FROM reservations WHERE date_str = ? AND hour = ? AND status = 'active'",
          [dateStr, hour]
        );

        const eligibility = evaluateSlotEligibility({
          clock,
          targetDateStr: dateStr,
          hour,
          slotReserved: Boolean(existingSlot),
          apt: aptCtx,
          playType,
        });

        if (!eligibility.bookable) {
          throw {
            status: 400,
            message: eligibility.reason || 'Bu saat dilimi için rezervasyon yapılamaz.',
          };
        }

        const { startMs, endMs } = getSlotBoundsMs(dateStr, hour);
        const insertedId = await tx.insertReturningId(
          `INSERT INTO reservations
           (apartment_no, date_str, hour, start_ms, end_ms, play_type, status, created_at_ms, cancelled_at_ms, late_cancel)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, 0)`,
          [apartmentNo, dateStr, hour, startMs, endMs, playType, clock.nowMs]
        );

        const row = await tx.queryOne<RawReservationRow>(
          'SELECT * FROM reservations WHERE id = ?',
          [insertedId]
        );
        if (!row) {
          throw { status: 500, message: 'Rezervasyon okunamadı.' };
        }

        return {
          reservation: mapReservationRow(row),
          primeOverrideUsed: eligibility.primeOverrideUsed,
        };
      });

      broadcastEvent({
        type: 'schedule:changed',
        action: 'booked',
        dateStr,
        hour,
        apartmentNo,
        reservationId: created.reservation.id,
      });

      res.status(201).json(created);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
        const typed = err as { status: number; message: string };
        res.status(typed.status).json({ error: typed.message });
        return;
      }
      if (isUniqueConstraintError(err)) {
        res.status(409).json({ error: 'Bu saat dilimi az önce başka bir daire tarafından rezerve edildi.' });
        return;
      }
      console.error('Reservation create error:', err);
      res.status(500).json({ error: 'Rezervasyon oluşturulurken bir hata oluştu.' });
    }
  });

  // Cancel reservation (enforces 4-hour cutoff & 15-day repeat late cancellation 1-week ban)
  app.post('/api/reservations/:id/cancel', requireAuth('resident'), async (req: AuthenticatedRequest, res) => {
    const apartmentNo = req.session!.apartmentNo!;
    const resId = Number(req.params.id);
    if (!Number.isInteger(resId) || resId <= 0) {
      res.status(400).json({ error: 'Geçersiz rezervasyon numarası.' });
      return;
    }

    const clock = getClockNow();

    try {
      const outcome = await withTransaction(async (tx) => {
        const row = await tx.queryOne<RawReservationRow>(
          'SELECT * FROM reservations WHERE id = ?',
          [resId]
        );

        if (!row) {
          throw { status: 404, message: 'Rezervasyon bulunamadı.' };
        }
        if (row.apartment_no !== apartmentNo) {
          throw { status: 403, message: 'Yalnızca kendi dairenize ait rezervasyonu iptal edebilirsiniz.' };
        }
        if (row.status !== 'active') {
          throw { status: 400, message: 'Bu rezervasyon zaten iptal edilmiş.' };
        }

        const startMs = Number(row.start_ms);
        const slotHour = Number(row.hour);
        if (startMs <= clock.nowMs) {
          throw {
            status: 400,
            message: 'Başlangıç saati geçmiş veya başlamış bir rezervasyon iptal edilemez.',
          };
        }

        const hoursUntilStart = (startMs - clock.nowMs) / (60 * 60 * 1000);
        const isLate = hoursUntilStart < FREE_CANCEL_HOURS;

        if (!isLate) {
          await tx.execute(
            "UPDATE reservations SET status = 'cancelled_ontime', cancelled_at_ms = ?, late_cancel = 0 WHERE id = ?",
            [clock.nowMs, resId]
          );

          return {
            lateCancel: false,
            penaltyAction: null as 'warning' | 'ban_7d' | null,
            banUntilMs: null as number | null,
            message: 'Rezervasyon 4 saatten uzun süre kala ücretsiz olarak iptal edildi.',
            cancelledReservation: { dateStr: row.date_str, hour: slotHour },
          };
        }

        const cutoff15d = clock.nowMs - LATE_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const priorLateCountRow = await tx.queryOne<{ cnt: number | string }>(
          "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'late_cancellation' AND created_at_ms >= ?",
          [apartmentNo, cutoff15d]
        );

        const isRepeat = Number(priorLateCountRow?.cnt ?? 0) >= 1;
        const action = isRepeat ? 'ban_7d' : 'warning';
        const note = isRepeat
          ? `15 günlük süreç içinde tekrarlanan geç iptal (${row.date_str} ${pad2(slotHour)}:00). 1 haftalık rezervasyon hakkı iptali uygulandı.`
          : `15 günlük süreç içinde ilk geç iptal (${row.date_str} ${pad2(slotHour)}:00). Uyarı verildi; tekrarı halinde 1 hafta rezervasyon hakkı iptal edilecektir.`;

        await tx.execute(
          "UPDATE reservations SET status = 'cancelled_late', cancelled_at_ms = ?, late_cancel = 1 WHERE id = ?",
          [clock.nowMs, resId]
        );

        await tx.execute(
          `INSERT INTO penalties (apartment_no, type, action, reservation_id, note, fee_amount, created_at_ms)
           VALUES (?, 'late_cancellation', ?, ?, ?, NULL, ?)`,
          [apartmentNo, action, resId, note, clock.nowMs]
        );

        let banUntilMs: number | null = null;
        if (isRepeat) {
          banUntilMs = clock.nowMs + LATE_CANCEL_BAN_DAYS * 24 * 60 * 60 * 1000;
          const aptRow = await tx.queryOne<{ ban_until_ms: number | string | null }>(
            'SELECT ban_until_ms FROM apartments WHERE apartment_no = ?',
            [apartmentNo]
          );
          const prevBan = aptRow?.ban_until_ms !== null && aptRow?.ban_until_ms !== undefined ? Number(aptRow.ban_until_ms) : 0;
          const effectiveBanUntil = Math.max(prevBan, banUntilMs);
          await tx.execute(
            'UPDATE apartments SET ban_until_ms = ?, ban_reason = ? WHERE apartment_no = ?',
            [effectiveBanUntil, '15 gün içinde tekrarlanan geç iptal cezası (1 hafta)', apartmentNo]
          );
          banUntilMs = effectiveBanUntil;
        }

        return {
          lateCancel: true,
          penaltyAction: action,
          banUntilMs,
          message: note,
          cancelledReservation: { dateStr: row.date_str, hour: slotHour },
        };
      });

      if (outcome.cancelledReservation) {
        broadcastEvent({
          type: 'schedule:changed',
          action: 'cancelled',
          dateStr: outcome.cancelledReservation.dateStr,
          hour: outcome.cancelledReservation.hour,
          apartmentNo,
          reservationId: resId,
        });
      }
      if (outcome.lateCancel) {
        broadcastEvent({ type: 'apartment:changed', apartmentNo });
      }

      res.json({
        lateCancel: outcome.lateCancel,
        penaltyAction: outcome.penaltyAction,
        banUntilMs: outcome.banUntilMs,
        message: outcome.message,
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
        const typed = err as { status: number; message: string };
        res.status(typed.status).json({ error: typed.message });
        return;
      }
      console.error('Cancel error:', err);
      res.status(500).json({ error: 'İptal işlemi sırasında hata oluştu.' });
    }
  });

  // --- ADMIN ROUTES ---

  app.get('/api/admin/overview', requireAuth('admin'), async (_req, res) => {
    try {
      const clock = getClockNow();
      const [apartments, reservationRows, penaltyRows] = await Promise.all([
        getAllApartmentSummaries(clock.nowMs, { includePasscodes: true }),
        db.queryAll<RawReservationRow>('SELECT * FROM reservations ORDER BY start_ms DESC LIMIT 1500'),
        db.queryAll<RawPenaltyRow>('SELECT * FROM penalties ORDER BY created_at_ms DESC LIMIT 1500'),
      ]);

      const payload: AdminOverviewResponse = {
        apartments,
        reservations: reservationRows.map(mapReservationRow),
        penalties: penaltyRows.map(mapPenaltyRow),
        nowMs: clock.nowMs,
        todayStr: clock.dateStr,
        databaseMode: isPostgres ? 'postgres' : 'sqlite',
      };
      res.json(payload);
    } catch (err) {
      console.error('Admin overview error:', err);
      res.status(500).json({ error: 'Yönetim verileri yüklenemedi.' });
    }
  });

  // Full system JSON backup export (Admin only — excludes admin_passcode_hash & cipher secrets)
  app.get('/api/admin/backup', requireAuth('admin'), async (_req, res) => {
    try {
      const clock = getClockNow();
      const [aptRows, resRows, penRows, postRows, replyRows] = await Promise.all([
        db.queryAll<{
          apartment_no: string;
          resident_label: string;
          password_hash: string | null;
          password_encrypted: string | null;
          ban_until_ms: number | string | null;
          ban_reason: string | null;
          created_at_ms: number | string;
        }>(
          'SELECT apartment_no, resident_label, password_hash, password_encrypted, ban_until_ms, ban_reason, created_at_ms FROM apartments'
        ),
        db.queryAll<RawReservationRow>('SELECT * FROM reservations ORDER BY id ASC'),
        db.queryAll<RawPenaltyRow>('SELECT * FROM penalties ORDER BY id ASC'),
        db.queryAll<RawPartnerPostRow>('SELECT * FROM partner_posts ORDER BY id ASC'),
        db.queryAll<RawPartnerReplyRow>('SELECT * FROM partner_replies ORDER BY id ASC'),
      ]);

      const apartments: BackupApartmentRecord[] = aptRows
        .sort((a, b) => sortApartmentNumbers(a.apartment_no, b.apartment_no))
        .map((row) => {
          const decrypted = decryptPasscodeForAdmin(row.password_encrypted);
          return {
            apartmentNo: row.apartment_no,
            residentLabel: row.resident_label,
            passcode: decrypted,
            passwordHash: decrypted ? null : row.password_hash,
            banUntilMs: row.ban_until_ms !== null ? Number(row.ban_until_ms) : null,
            banReason: row.ban_reason,
            createdAtMs: Number(row.created_at_ms),
          };
        });

      const partnerPosts: BackupPartnerPostRecord[] = postRows.map((p) => ({
        id: Number(p.id),
        apartmentNo: p.apartment_no,
        nickname: p.nickname,
        skillLevel: Number(p.skill_level),
        sessionFormat: p.session_format,
        dateStr: p.date_str,
        startHour: Number(p.start_hour),
        endHour: Number(p.end_hour),
        note: p.note,
        status: p.status,
        createdAtMs: Number(p.created_at_ms),
      }));

      const partnerReplies: BackupPartnerReplyRecord[] = replyRows.map((r) => ({
        id: Number(r.id),
        postId: Number(r.post_id),
        apartmentNo: r.apartment_no,
        nickname: r.nickname,
        message: r.message,
        createdAtMs: Number(r.created_at_ms),
      }));

      const backup: SystemBackupPayload = {
        version: 1,
        app: 'soyaksiestatenis',
        exportedAtMs: clock.nowMs,
        exportedAtLabel: clock.label,
        sourceDatabase: isPostgres ? 'postgres' : 'sqlite',
        data: {
          apartments,
          reservations: resRows.map(mapReservationRow),
          penalties: penRows.map(mapPenaltyRow),
          partnerPosts,
          partnerReplies,
        },
      };

      res.json(backup);
    } catch (err) {
      console.error('Admin backup export error:', err);
      res.status(500).json({ error: 'Sistem yedeği oluşturulamadı.' });
    }
  });

  // Full system JSON backup restore (Admin only — transactional)
  app.post('/api/admin/restore', requireAuth('admin'), async (req, res) => {
    try {
      const body = req.body as Partial<SystemBackupPayload> | undefined;
      if (!body || body.version !== 1 || !body.data || typeof body.data !== 'object') {
        res.status(400).json({ error: 'Geçersiz yedek dosyası formatı.' });
        return;
      }

      const rawData = body.data as Record<string, unknown>;
      const rawApts = Array.isArray(rawData.apartments) ? rawData.apartments : null;
      const rawRes = Array.isArray(rawData.reservations) ? rawData.reservations : [];
      const rawPen = Array.isArray(rawData.penalties) ? rawData.penalties : [];
      const rawPosts = Array.isArray(rawData.partnerPosts) ? rawData.partnerPosts : [];
      const rawReplies = Array.isArray(rawData.partnerReplies) ? rawData.partnerReplies : [];

      if (!rawApts || rawApts.length > 5000 || rawRes.length > 50000 || rawPen.length > 50000) {
        res.status(400).json({ error: 'Yedek dosyası içeriği geçersiz veya sınırları aşıyor.' });
        return;
      }

      const aptRegex = /^[A-Za-z0-9ğüşıöçĞÜŞİÖÇ./\-\s]+$/;
      const cleanApts: {
        apartmentNo: string;
        residentLabel: string;
        passwordHash: string | null;
        passwordEncrypted: string | null;
        banUntilMs: number | null;
        banReason: string | null;
        createdAtMs: number;
      }[] = [];
      const aptSet = new Set<string>();

      for (const item of rawApts) {
        if (!item || typeof item !== 'object') {
          res.status(400).json({ error: 'Yedek dosyasında bozuk daire kaydı var.' });
          return;
        }
        const rec = item as Partial<BackupApartmentRecord>;
        const apartmentNo = typeof rec.apartmentNo === 'string' ? rec.apartmentNo.trim() : '';
        if (!apartmentNo || apartmentNo.length > 24 || !aptRegex.test(apartmentNo) || aptSet.has(apartmentNo)) {
          res.status(400).json({ error: `Geçersiz veya mükerrer daire numarası: ${apartmentNo || '?'}` });
          return;
        }
        aptSet.add(apartmentNo);
        const residentLabel =
          typeof rec.residentLabel === 'string' && rec.residentLabel.trim()
            ? rec.residentLabel.trim().slice(0, 64)
            : `Daire ${apartmentNo}`;
        const passcode =
          typeof rec.passcode === 'string' && rec.passcode.trim().length >= 4 && rec.passcode.trim().length <= 64
            ? rec.passcode.trim()
            : null;
        const fallbackHash =
          !passcode && typeof rec.passwordHash === 'string' && /^[a-f0-9]+:[a-f0-9]+$/i.test(rec.passwordHash)
            ? rec.passwordHash
            : null;

        cleanApts.push({
          apartmentNo,
          residentLabel,
          passwordHash: passcode ? hashPasscode(passcode) : fallbackHash,
          passwordEncrypted: passcode ? encryptPasscodeForAdmin(passcode) : null,
          banUntilMs:
            typeof rec.banUntilMs === 'number' && Number.isFinite(rec.banUntilMs) ? rec.banUntilMs : null,
          banReason: typeof rec.banReason === 'string' ? rec.banReason.slice(0, 300) : null,
          createdAtMs:
            typeof rec.createdAtMs === 'number' && Number.isFinite(rec.createdAtMs)
              ? rec.createdAtMs
              : Date.now(),
        });
      }

      const cleanRes: ReservationItem[] = [];
      const resIdSet = new Set<number>();
      for (const item of rawRes) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Partial<ReservationItem>;
        const id = Number(r.id);
        const apartmentNo = typeof r.apartmentNo === 'string' ? r.apartmentNo.trim() : '';
        const dateStr = typeof r.dateStr === 'string' ? r.dateStr.trim() : '';
        const hour = Number(r.hour);
        if (
          !Number.isInteger(id) ||
          id <= 0 ||
          resIdSet.has(id) ||
          !aptSet.has(apartmentNo) ||
          !isValidDateStr(dateStr) ||
          !Number.isInteger(hour) ||
          hour < COURT_OPEN_HOUR ||
          hour >= COURT_CLOSE_HOUR ||
          (r.playType !== 'match' && r.playType !== 'solo_training') ||
          (r.status !== 'active' && r.status !== 'cancelled_ontime' && r.status !== 'cancelled_late')
        ) {
          res.status(400).json({ error: 'Yedek dosyasında geçersiz rezervasyon kaydı tespit edildi.' });
          return;
        }
        resIdSet.add(id);
        const bounds = getSlotBoundsMs(dateStr, hour);
        cleanRes.push({
          id,
          apartmentNo,
          dateStr,
          hour,
          startMs: typeof r.startMs === 'number' && Number.isFinite(r.startMs) ? r.startMs : bounds.startMs,
          endMs: typeof r.endMs === 'number' && Number.isFinite(r.endMs) ? r.endMs : bounds.endMs,
          playType: r.playType,
          status: r.status,
          createdAtMs:
            typeof r.createdAtMs === 'number' && Number.isFinite(r.createdAtMs)
              ? r.createdAtMs
              : Date.now(),
          cancelledAtMs:
            typeof r.cancelledAtMs === 'number' && Number.isFinite(r.cancelledAtMs)
              ? r.cancelledAtMs
              : null,
          lateCancel: Boolean(r.lateCancel),
        });
      }

      const cleanPen: PenaltyItem[] = [];
      const penIdSet = new Set<number>();
      for (const item of rawPen) {
        if (!item || typeof item !== 'object') continue;
        const p = item as Partial<PenaltyItem>;
        const id = Number(p.id);
        const apartmentNo = typeof p.apartmentNo === 'string' ? p.apartmentNo.trim() : '';
        if (
          !Number.isInteger(id) ||
          id <= 0 ||
          penIdSet.has(id) ||
          !aptSet.has(apartmentNo) ||
          (p.type !== 'late_cancellation' && p.type !== 'non_resident_violation') ||
          (p.action !== 'warning' && p.action !== 'ban_7d' && p.action !== 'ban_30d')
        ) {
          res.status(400).json({ error: 'Yedek dosyasında geçersiz ihlal/ceza kaydı tespit edildi.' });
          return;
        }
        penIdSet.add(id);
        const linkedResId =
          p.reservationId !== null && p.reservationId !== undefined && resIdSet.has(Number(p.reservationId))
            ? Number(p.reservationId)
            : null;
        cleanPen.push({
          id,
          apartmentNo,
          type: p.type,
          action: p.action,
          reservationId: linkedResId,
          note: typeof p.note === 'string' ? p.note.slice(0, 500) : '',
          feeAmount: typeof p.feeAmount === 'string' ? p.feeAmount.slice(0, 120) : null,
          createdAtMs:
            typeof p.createdAtMs === 'number' && Number.isFinite(p.createdAtMs)
              ? p.createdAtMs
              : Date.now(),
        });
      }

      const cleanPosts: BackupPartnerPostRecord[] = [];
      const postIdSet = new Set<number>();
      for (const item of rawPosts) {
        if (!item || typeof item !== 'object') continue;
        const p = item as Partial<BackupPartnerPostRecord>;
        const id = Number(p.id);
        const apartmentNo = typeof p.apartmentNo === 'string' ? p.apartmentNo.trim() : '';
        if (
          !Number.isInteger(id) ||
          id <= 0 ||
          postIdSet.has(id) ||
          !aptSet.has(apartmentNo) ||
          typeof p.nickname !== 'string' ||
          !isValidDateStr(typeof p.dateStr === 'string' ? p.dateStr : '') ||
          (p.sessionFormat !== 'match' && p.sessionFormat !== 'training' && p.sessionFormat !== 'rally') ||
          (p.status !== 'open' && p.status !== 'matched' && p.status !== 'closed')
        ) {
          continue;
        }
        postIdSet.add(id);
        cleanPosts.push({
          id,
          apartmentNo,
          nickname: p.nickname.trim().slice(0, 24) || 'Oyuncu',
          skillLevel: Math.min(7, Math.max(1, Number(p.skillLevel) || 3)),
          sessionFormat: p.sessionFormat,
          dateStr: p.dateStr!,
          startHour: Math.min(22, Math.max(7, Number(p.startHour) || 18)),
          endHour: Math.min(23, Math.max(8, Number(p.endHour) || 20)),
          note: typeof p.note === 'string' ? p.note.slice(0, 240) : null,
          status: p.status,
          createdAtMs:
            typeof p.createdAtMs === 'number' && Number.isFinite(p.createdAtMs)
              ? p.createdAtMs
              : Date.now(),
        });
      }

      const cleanReplies: BackupPartnerReplyRecord[] = [];
      const replyIdSet = new Set<number>();
      for (const item of rawReplies) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Partial<BackupPartnerReplyRecord>;
        const id = Number(r.id);
        const postId = Number(r.postId);
        const apartmentNo = typeof r.apartmentNo === 'string' ? r.apartmentNo.trim() : '';
        if (
          !Number.isInteger(id) ||
          id <= 0 ||
          replyIdSet.has(id) ||
          !postIdSet.has(postId) ||
          !aptSet.has(apartmentNo) ||
          typeof r.nickname !== 'string' ||
          typeof r.message !== 'string'
        ) {
          continue;
        }
        replyIdSet.add(id);
        cleanReplies.push({
          id,
          postId,
          apartmentNo,
          nickname: r.nickname.trim().slice(0, 24) || 'Oyuncu',
          message: r.message.trim().slice(0, 300),
          createdAtMs:
            typeof r.createdAtMs === 'number' && Number.isFinite(r.createdAtMs)
              ? r.createdAtMs
              : Date.now(),
        });
      }

      await withTransaction(async (tx) => {
        await tx.execute('DELETE FROM partner_replies');
        await tx.execute('DELETE FROM partner_posts');
        await tx.execute('DELETE FROM penalties');
        await tx.execute('DELETE FROM reservations');
        await tx.execute('DELETE FROM apartments');

        for (const a of cleanApts) {
          await tx.execute(
            `INSERT INTO apartments (apartment_no, resident_label, password_hash, password_encrypted, ban_until_ms, ban_reason, created_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              a.apartmentNo,
              a.residentLabel,
              a.passwordHash,
              a.passwordEncrypted,
              a.banUntilMs,
              a.banReason,
              a.createdAtMs,
            ]
          );
        }

        for (const r of cleanRes) {
          await tx.execute(
            `INSERT INTO reservations (id, apartment_no, date_str, hour, start_ms, end_ms, play_type, status, created_at_ms, cancelled_at_ms, late_cancel)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.apartmentNo,
              r.dateStr,
              r.hour,
              r.startMs,
              r.endMs,
              r.playType,
              r.status,
              r.createdAtMs,
              r.cancelledAtMs,
              r.lateCancel ? 1 : 0,
            ]
          );
        }

        for (const p of cleanPen) {
          await tx.execute(
            `INSERT INTO penalties (id, apartment_no, type, action, reservation_id, note, fee_amount, created_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              p.id,
              p.apartmentNo,
              p.type,
              p.action,
              p.reservationId,
              p.note,
              p.feeAmount,
              p.createdAtMs,
            ]
          );
        }

        for (const post of cleanPosts) {
          await tx.execute(
            `INSERT INTO partner_posts (id, apartment_no, nickname, skill_level, session_format, date_str, start_hour, end_hour, note, status, created_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              post.id,
              post.apartmentNo,
              post.nickname,
              post.skillLevel,
              post.sessionFormat,
              post.dateStr,
              post.startHour,
              post.endHour,
              post.note,
              post.status,
              post.createdAtMs,
            ]
          );
        }

        for (const reply of cleanReplies) {
          await tx.execute(
            `INSERT INTO partner_replies (id, post_id, apartment_no, nickname, message, created_at_ms)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              reply.id,
              reply.postId,
              reply.apartmentNo,
              reply.nickname,
              reply.message,
              reply.createdAtMs,
            ]
          );
        }

        if (isPostgres) {
          for (const tbl of ['reservations', 'penalties', 'partner_posts', 'partner_replies']) {
            await tx.execute(
              `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), (SELECT COUNT(*) > 0 FROM ${tbl}))`
            );
          }
        }
      });

      broadcastEvent({ type: 'directory:changed' });
      broadcastEvent({ type: 'partner:changed' });

      res.json({
        ok: true,
        counts: {
          apartments: cleanApts.length,
          reservations: cleanRes.length,
          penalties: cleanPen.length,
          partnerPosts: cleanPosts.length,
          partnerReplies: cleanReplies.length,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        res.status(400).json({ error: 'Yedek dosyasında çakışan aktif saat dilimi bulunuyor.' });
        return;
      }
      console.error('Admin restore error:', err);
      res.status(500).json({ error: 'Yedek geri yüklenirken hata oluştu.' });
    }
  });

  // Add a new apartment unit
  app.post('/api/admin/apartments', requireAuth('admin'), async (req, res) => {
    try {
      const apartmentNo =
        typeof req.body?.apartmentNo === 'string' ? req.body.apartmentNo.trim() : '';
      const residentLabelRaw =
        typeof req.body?.residentLabel === 'string' ? req.body.residentLabel.trim() : '';
      const passwordRaw =
        typeof req.body?.password === 'string' ? req.body.password.trim() : '';

      if (
        !apartmentNo ||
        apartmentNo.length > 24 ||
        !/^[A-Za-z0-9ğüşıöçĞÜŞİÖÇ./\-\s]+$/.test(apartmentNo)
      ) {
        res.status(400).json({
          error: 'Geçerli bir daire/blok numarası girin (en fazla 24 karakter, örn: B1-12 veya K2/4).',
        });
        return;
      }

      const existing = await db.queryOne<{ apartment_no: string }>(
        'SELECT apartment_no FROM apartments WHERE apartment_no = ?',
        [apartmentNo]
      );
      if (existing) {
        res.status(409).json({ error: `${apartmentNo} zaten kayıtlı.` });
        return;
      }

      if (passwordRaw && passwordRaw.length < 4) {
        res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
        return;
      }

      const generated = passwordRaw || generateReadablePasscode(8);
      const hash = hashPasscode(generated);
      const encrypted = encryptPasscodeForAdmin(generated);
      const residentLabel = residentLabelRaw || `Daire ${apartmentNo}`;

      await db.execute(
        'INSERT INTO apartments (apartment_no, resident_label, password_hash, password_encrypted, ban_until_ms, ban_reason, created_at_ms) VALUES (?, ?, ?, ?, NULL, NULL, ?)',
        [apartmentNo, residentLabel, hash, encrypted, Date.now()]
      );

      broadcastEvent({ type: 'directory:changed' });

      res.status(201).json({
        apartmentNo,
        residentLabel,
        issuedPasscode: generated,
      });
    } catch (err) {
      console.error('Add apartment error:', err);
      res.status(500).json({ error: 'Daire eklenirken hata oluştu.' });
    }
  });

  // Bulk-delete unassigned apartments (those without a password) so admin keeps only invited residents
  app.delete('/api/admin/apartments/unassigned/cleanup', requireAuth('admin'), async (_req, res) => {
    try {
      const info = await db.execute('DELETE FROM apartments WHERE password_hash IS NULL');
      broadcastEvent({ type: 'directory:changed' });
      res.json({ deletedCount: info.changes });
    } catch (err) {
      console.error('Cleanup unassigned apartments error:', err);
      res.status(500).json({ error: 'Şifresiz daireler temizlenirken hata oluştu.' });
    }
  });

  // Delete an apartment unit (Admin only)
  app.delete('/api/admin/apartments/:apartmentNo', requireAuth('admin'), async (req, res) => {
    try {
      const apartmentNo = req.params.apartmentNo.trim();
      const info = await db.execute('DELETE FROM apartments WHERE apartment_no = ?', [apartmentNo]);
      if (info.changes === 0) {
        res.status(404).json({ error: 'Daire bulunamadı.' });
        return;
      }
      broadcastEvent({ type: 'directory:changed' });
      broadcastEvent({ type: 'apartment:changed', apartmentNo });
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete apartment error:', err);
      res.status(500).json({ error: 'Daire silinirken hata oluştu.' });
    }
  });

  // Assign or reset a single apartment's passcode
  app.post('/api/admin/apartments/:apartmentNo/password', requireAuth('admin'), async (req, res) => {
    try {
      const apartmentNo = req.params.apartmentNo.trim();
      const customPassword =
        typeof req.body?.password === 'string' ? req.body.password.trim() : '';

      const apt = await db.queryOne<{ apartment_no: string }>(
        'SELECT apartment_no FROM apartments WHERE apartment_no = ?',
        [apartmentNo]
      );
      if (!apt) {
        res.status(404).json({ error: 'Daire bulunamadı.' });
        return;
      }

      if (customPassword && (customPassword.length < 4 || customPassword.length > 64)) {
        res.status(400).json({ error: 'Daire şifresi 4 ile 64 karakter arasında olmalıdır.' });
        return;
      }

      const issuedPasscode = customPassword || generateReadablePasscode(8);
      const hash = hashPasscode(issuedPasscode);
      const encrypted = encryptPasscodeForAdmin(issuedPasscode);

      await db.execute(
        'UPDATE apartments SET password_hash = ?, password_encrypted = ? WHERE apartment_no = ?',
        [hash, encrypted, apartmentNo]
      );

      broadcastEvent({ type: 'directory:changed' });

      res.json({
        apartmentNo,
        issuedPasscode,
      });
    } catch (err) {
      console.error('Set password error:', err);
      res.status(500).json({ error: 'Şifre güncellenirken hata oluştu.' });
    }
  });

  // Batch-assign passcodes to all apartments without a passcode yet
  app.post('/api/admin/apartments/batch-passwords', requireAuth('admin'), async (_req, res) => {
    try {
      const missingRows = await db.queryAll<{ apartment_no: string }>(
        'SELECT apartment_no FROM apartments WHERE password_hash IS NULL'
      );

      if (missingRows.length === 0) {
        res.json({ issued: [] });
        return;
      }

      const issued: { apartmentNo: string; passcode: string }[] = [];

      await withTransaction(async (tx) => {
        for (const row of missingRows) {
          const passcode = generateReadablePasscode(8);
          const hash = hashPasscode(passcode);
          const encrypted = encryptPasscodeForAdmin(passcode);
          await tx.execute(
            'UPDATE apartments SET password_hash = ?, password_encrypted = ? WHERE apartment_no = ?',
            [hash, encrypted, row.apartment_no]
          );
          issued.push({ apartmentNo: row.apartment_no, passcode });
        }
      });

      broadcastEvent({ type: 'directory:changed' });

      res.json({ issued });
    } catch (err) {
      console.error('Batch password error:', err);
      res.status(500).json({ error: 'Toplu şifre üretilirken hata oluştu.' });
    }
  });

  // Record a non-resident court usage violation (1st = warning, 2nd+ = 1 month ban + optional fee)
  app.post('/api/admin/violations', requireAuth('admin'), async (req, res) => {
    try {
      const apartmentNo =
        typeof req.body?.apartmentNo === 'string' ? req.body.apartmentNo.trim() : '';
      const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      const feeRaw = typeof req.body?.feeAmount === 'string' ? req.body.feeAmount.trim() : '';
      const reservationId =
        req.body?.reservationId !== undefined && req.body?.reservationId !== null
          ? Number(req.body.reservationId)
          : null;

      if (!apartmentNo) {
        res.status(400).json({ error: 'Daire numarası seçilmelidir.' });
        return;
      }

      const apt = await db.queryOne<{ apartment_no: string; ban_until_ms: number | string | null }>(
        'SELECT apartment_no, ban_until_ms FROM apartments WHERE apartment_no = ?',
        [apartmentNo]
      );

      if (!apt) {
        res.status(404).json({ error: 'Daire bulunamadı.' });
        return;
      }

      const clock = getClockNow();

      const outcome = await withTransaction(async (tx) => {
        const priorRow = await tx.queryOne<{ cnt: number | string }>(
          "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'non_resident_violation'",
          [apartmentNo]
        );

        const isRepeat = Number(priorRow?.cnt ?? 0) >= 1;
        const action = isRepeat ? 'ban_30d' : 'warning';
        const defaultNote = isRepeat
          ? 'Daire sakini olmadan tekrarlanan kort kullanımı tespit edildi. 1 aylık rezervasyon hakkı iptal edildi.'
          : 'Kortu kullanan kişiler arasında daire sakini bulunmadığı tespit edildi. İlk tespit uyarısı verildi.';
        const note = noteRaw
          ? `${noteRaw} (${isRepeat ? 'Tekrar ihlal — 1 ay kısıtlama' : 'İlk tespit — Uyarı'})`
          : defaultNote;
        const feeAmount = isRepeat && feeRaw ? feeRaw : null;

        await tx.execute(
          `INSERT INTO penalties (apartment_no, type, action, reservation_id, note, fee_amount, created_at_ms)
           VALUES (?, 'non_resident_violation', ?, ?, ?, ?, ?)`,
          [
            apartmentNo,
            action,
            reservationId && Number.isInteger(reservationId) ? reservationId : null,
            note,
            feeAmount,
            clock.nowMs,
          ]
        );

        let banUntilMs: number | null = null;
        if (isRepeat) {
          banUntilMs = clock.nowMs + VIOLATION_BAN_DAYS * 24 * 60 * 60 * 1000;
          const prevBan = apt.ban_until_ms !== null ? Number(apt.ban_until_ms) : 0;
          const effectiveBanUntil = Math.max(prevBan, banUntilMs);
          const banReason = feeAmount
            ? `Daire sakini ihlali (1 ay kısıtlama · Ücretli ceza: ${feeAmount})`
            : 'Daire sakini olmadan tekrarlanan kort kullanımı (1 ay kısıtlama)';
          await tx.execute(
            'UPDATE apartments SET ban_until_ms = ?, ban_reason = ? WHERE apartment_no = ?',
            [effectiveBanUntil, banReason, apartmentNo]
          );
          banUntilMs = effectiveBanUntil;
        }

        return { action, banUntilMs, note, feeAmount };
      });

      broadcastEvent({ type: 'apartment:changed', apartmentNo });

      res.status(201).json(outcome);
    } catch (err) {
      console.error('Log violation error:', err);
      res.status(500).json({ error: 'İhlal kaydedilirken hata oluştu.' });
    }
  });

  // Management override to lift an active apartment ban
  app.post('/api/admin/apartments/:apartmentNo/lift-ban', requireAuth('admin'), async (req, res) => {
    try {
      const apartmentNo = req.params.apartmentNo.trim();
      const info = await db.execute(
        'UPDATE apartments SET ban_until_ms = NULL, ban_reason = NULL WHERE apartment_no = ?',
        [apartmentNo]
      );
      if (info.changes === 0) {
        res.status(404).json({ error: 'Daire bulunamadı.' });
        return;
      }
      broadcastEvent({ type: 'apartment:changed', apartmentNo });
      res.json({ ok: true });
    } catch (err) {
      console.error('Lift ban error:', err);
      res.status(500).json({ error: 'Kısıtlama kaldırılırken hata oluştu.' });
    }
  });

  // Management cancellation of a reservation (without automated resident late penalty)
  app.post('/api/admin/reservations/:id/cancel', requireAuth('admin'), async (req, res) => {
    try {
      const resId = Number(req.params.id);
      if (!Number.isInteger(resId) || resId <= 0) {
        res.status(400).json({ error: 'Geçersiz rezervasyon numarası.' });
        return;
      }
      const clock = getClockNow();
      const targetRow = await db.queryOne<{ apartment_no: string; date_str: string; hour: number | string }>(
        "SELECT apartment_no, date_str, hour FROM reservations WHERE id = ? AND status = 'active'",
        [resId]
      );
      if (!targetRow) {
        res.status(404).json({ error: 'Aktif rezervasyon bulunamadı.' });
        return;
      }
      await db.execute(
        "UPDATE reservations SET status = 'cancelled_ontime', cancelled_at_ms = ?, late_cancel = 0 WHERE id = ? AND status = 'active'",
        [clock.nowMs, resId]
      );
      broadcastEvent({
        type: 'schedule:changed',
        action: 'cancelled',
        dateStr: targetRow.date_str,
        hour: Number(targetRow.hour),
        apartmentNo: targetRow.apartment_no,
        reservationId: resId,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Admin cancel error:', err);
      res.status(500).json({ error: 'Rezervasyon iptal edilirken hata oluştu.' });
    }
  });

  // --- PARTNER FINDER ROUTES (Oyun Arkadaşı Arayanlar - apartment_no is NEVER exposed) ---

  app.get('/api/partners', async (req, res) => {
    try {
      const clock = getClockNow();
      const session = parseBearerSession(req);
      const viewerAptNo = session?.role === 'resident' ? session.apartmentNo ?? null : null;
      const minDate = shiftDateStr(clock.dateStr, -1);

      const postRows = await db.queryAll<RawPartnerPostRow>(
        'SELECT * FROM partner_posts WHERE date_str >= ? ORDER BY created_at_ms DESC LIMIT 120',
        [minDate]
      );

      const replyRows =
        postRows.length > 0
          ? await db.queryAll<RawPartnerReplyRow>(
              `SELECT * FROM partner_replies WHERE post_id IN (${postRows.map(() => '?').join(',')}) ORDER BY created_at_ms ASC`,
              postRows.map((p) => Number(p.id))
            )
          : [];

      const repliesByPost = new Map<number, PartnerReplyItem[]>();
      for (const r of replyRows) {
        const mapped = mapPartnerReplyRow(r, viewerAptNo);
        const list = repliesByPost.get(mapped.postId) ?? [];
        list.push(mapped);
        repliesByPost.set(mapped.postId, list);
      }

      const payload: PartnerBoardResponse = {
        posts: postRows.map((p) =>
          mapPartnerPostRow(p, viewerAptNo, repliesByPost.get(Number(p.id)) ?? [])
        ),
        todayStr: clock.dateStr,
        nowMs: clock.nowMs,
      };
      res.json(payload);
    } catch (err) {
      console.error('Partner board fetch error:', err);
      res.status(500).json({ error: 'Oyun arkadaşı ilanları yüklenemedi.' });
    }
  });

  app.post('/api/partners', requireAuth('resident'), async (req: AuthenticatedRequest, res) => {
    try {
      const apartmentNo = req.session!.apartmentNo!;
      const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
      const skillLevel = Number(req.body?.skillLevel);
      const formatRaw = req.body?.sessionFormat;
      const sessionFormat: PartnerFormat | null =
        formatRaw === 'match' || formatRaw === 'training' || formatRaw === 'rally'
          ? formatRaw
          : null;
      const dateStr = typeof req.body?.dateStr === 'string' ? req.body.dateStr.trim() : '';
      const startHour = Number(req.body?.startHour);
      const endHour = Number(req.body?.endHour);
      const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

      if (nickname.length < 2 || nickname.length > 24) {
        res.status(400).json({ error: 'Takma ad (nickname) 2 ile 24 karakter arasında olmalıdır.' });
        return;
      }
      if (!Number.isInteger(skillLevel) || skillLevel < 1 || skillLevel > 7) {
        res.status(400).json({ error: 'Oyun seviyesi 1 ile 7 arasında seçilmelidir.' });
        return;
      }
      if (!sessionFormat) {
        res.status(400).json({ error: 'Oyun türü (Maç, Antrenman veya Ralli) seçilmelidir.' });
        return;
      }
      const clock = getClockNow();
      if (!isValidDateStr(dateStr) || dateStr < clock.dateStr) {
        res.status(400).json({ error: 'Geçerli ve bugünden eski olmayan bir tarih seçin.' });
        return;
      }
      if (
        !Number.isInteger(startHour) ||
        !Number.isInteger(endHour) ||
        startHour < COURT_OPEN_HOUR ||
        endHour > COURT_CLOSE_HOUR ||
        endHour <= startHour
      ) {
        res.status(400).json({ error: 'Geçerli bir saat aralığı seçin (07:00 - 23:00).' });
        return;
      }
      if (noteRaw.length > 240) {
        res.status(400).json({ error: 'Açıklama notu en fazla 240 karakter olabilir.' });
        return;
      }

      const createdAtMs = Date.now();
      const insertedId = await db.insertReturningId(
        `INSERT INTO partner_posts
         (apartment_no, nickname, skill_level, session_format, date_str, start_hour, end_hour, note, status, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        [
          apartmentNo,
          nickname,
          skillLevel,
          sessionFormat,
          dateStr,
          startHour,
          endHour,
          noteRaw || null,
          createdAtMs,
        ]
      );

      const row = await db.queryOne<RawPartnerPostRow>(
        'SELECT * FROM partner_posts WHERE id = ?',
        [insertedId]
      );
      if (!row) {
        res.status(500).json({ error: 'İlan oluşturuldu ancak okunamadı.' });
        return;
      }

      broadcastEvent({ type: 'partner:changed' });
      res.status(201).json({ post: mapPartnerPostRow(row, apartmentNo, []) });
    } catch (err) {
      console.error('Create partner post error:', err);
      res.status(500).json({ error: 'Oyun arkadaşı ilanı oluşturulurken hata oluştu.' });
    }
  });

  app.post('/api/partners/:id/replies', requireAuth('resident'), async (req: AuthenticatedRequest, res) => {
    try {
      const apartmentNo = req.session!.apartmentNo!;
      const postId = Number(req.params.id);
      if (!Number.isInteger(postId) || postId <= 0) {
        res.status(400).json({ error: 'Geçersiz ilan numarası.' });
        return;
      }

      const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

      if (nickname.length < 2 || nickname.length > 24) {
        res.status(400).json({ error: 'Takma ad (nickname) 2 ile 24 karakter arasında olmalıdır.' });
        return;
      }
      if (message.length < 1 || message.length > 300) {
        res.status(400).json({ error: 'Cevap mesajı 1 ile 300 karakter arasında olmalıdır.' });
        return;
      }

      const post = await db.queryOne<{ id: number | string; status: PartnerPostStatus }>(
        'SELECT id, status FROM partner_posts WHERE id = ?',
        [postId]
      );
      if (!post) {
        res.status(404).json({ error: 'İlan bulunamadı.' });
        return;
      }
      if (post.status === 'closed') {
        res.status(400).json({ error: 'Bu ilan kapatılmış olduğu için cevap yazılamaz.' });
        return;
      }

      const createdAtMs = Date.now();
      const replyId = await db.insertReturningId(
        'INSERT INTO partner_replies (post_id, apartment_no, nickname, message, created_at_ms) VALUES (?, ?, ?, ?, ?)',
        [postId, apartmentNo, nickname, message, createdAtMs]
      );
      const replyRow = await db.queryOne<RawPartnerReplyRow>(
        'SELECT * FROM partner_replies WHERE id = ?',
        [replyId]
      );

      broadcastEvent({ type: 'partner:changed' });
      res.status(201).json({
        reply: replyRow ? mapPartnerReplyRow(replyRow, apartmentNo) : null,
      });
    } catch (err) {
      console.error('Create partner reply error:', err);
      res.status(500).json({ error: 'Cevap gönderilirken hata oluştu.' });
    }
  });

  app.patch('/api/partners/:id/status', requireAuth('resident'), async (req: AuthenticatedRequest, res) => {
    try {
      const apartmentNo = req.session!.apartmentNo!;
      const postId = Number(req.params.id);
      const nextStatus = req.body?.status;
      if (!Number.isInteger(postId) || postId <= 0) {
        res.status(400).json({ error: 'Geçersiz ilan numarası.' });
        return;
      }
      if (nextStatus !== 'open' && nextStatus !== 'matched' && nextStatus !== 'closed') {
        res.status(400).json({ error: 'Geçersiz ilan durumu.' });
        return;
      }

      const post = await db.queryOne<{ apartment_no: string }>(
        'SELECT apartment_no FROM partner_posts WHERE id = ?',
        [postId]
      );
      if (!post) {
        res.status(404).json({ error: 'İlan bulunamadı.' });
        return;
      }
      if (post.apartment_no !== apartmentNo) {
        res.status(403).json({ error: 'Yalnızca kendi ilanınızın durumunu güncelleyebilirsiniz.' });
        return;
      }

      await db.execute('UPDATE partner_posts SET status = ? WHERE id = ?', [nextStatus, postId]);
      broadcastEvent({ type: 'partner:changed' });
      res.json({ ok: true, status: nextStatus });
    } catch (err) {
      console.error('Update partner post status error:', err);
      res.status(500).json({ error: 'İlan durumu güncellenemedi.' });
    }
  });

  app.delete('/api/partners/:id', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isInteger(postId) || postId <= 0) {
        res.status(400).json({ error: 'Geçersiz ilan numarası.' });
        return;
      }
      const post = await db.queryOne<{ apartment_no: string }>(
        'SELECT apartment_no FROM partner_posts WHERE id = ?',
        [postId]
      );
      if (!post) {
        res.status(404).json({ error: 'İlan bulunamadı.' });
        return;
      }
      const isAdmin = req.session!.role === 'admin';
      const isOwner =
        req.session!.role === 'resident' && req.session!.apartmentNo === post.apartment_no;
      if (!isAdmin && !isOwner) {
        res.status(403).json({ error: 'Bu ilanı silme yetkiniz bulunmamaktadır.' });
        return;
      }

      await db.execute('DELETE FROM partner_posts WHERE id = ?', [postId]);
      broadcastEvent({ type: 'partner:changed' });
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete partner post error:', err);
      res.status(500).json({ error: 'İlan silinirken hata oluştu.' });
    }
  });

  // İzmir · Karşıyaka weather forecast (30-min memory + DB cache, Open-Meteo + MET Norway fallback, 429 cooldown)
  const KARSIYAKA_MET_NO_URL =
    'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=38.4556&lon=27.1103';
  const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
  const OPEN_METEO_COOLDOWN_MS = 30 * 60 * 1000;
  const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

  let weatherCache: { expiresAtMs: number; data: WeatherResponse } | null = null;
  let openMeteoCooldownUntilMs = 0;
  let weatherFailureCooldownUntilMs = 0;
  let weatherInFlight: Promise<WeatherResponse> | null = null;

  function metSymbolToWmo(symbolCode: string | undefined): number {
    const s = (symbolCode || '').toLowerCase();
    if (!s) return 2;
    if (s.includes('thunder')) return 95;
    if (s.includes('snow') || s.includes('sleet')) return 71;
    if (s.includes('rainshowers')) return 80;
    if (s.includes('rain')) return 61;
    if (s.includes('drizzle')) return 51;
    if (s.includes('fog')) return 45;
    if (s.startsWith('clearsky')) return 0;
    if (s.startsWith('fair')) return 1;
    if (s.startsWith('partlycloudy')) return 2;
    if (s.startsWith('cloudy')) return 3;
    return 2;
  }

  function estimateMetPrecipProb(symbolCode: string | undefined, precipMm: number): number {
    const s = (symbolCode || '').toLowerCase();
    if (precipMm >= 1.5 || s.includes('heavyrain')) return 85;
    if (precipMm >= 0.3 || s.includes('rain') || s.includes('sleet') || s.includes('thunder')) return 65;
    if (precipMm > 0 || s.includes('drizzle')) return 40;
    if (s.includes('cloudy')) return 10;
    return 0;
  }

  function parseMetNoPayload(rawInput: unknown, nowMs: number): WeatherResponse {
    const raw = (rawInput ?? {}) as {
      properties?: {
        timeseries?: {
          time?: string;
          data?: {
            instant?: { details?: { air_temperature?: number; wind_speed?: number } };
            next_1_hours?: {
              summary?: { symbol_code?: string };
              details?: { precipitation_amount?: number };
            };
            next_6_hours?: {
              summary?: { symbol_code?: string };
              details?: { precipitation_amount?: number };
            };
          };
        }[];
      };
    };

    const series = raw.properties?.timeseries ?? [];
    const hourly: WeatherHourlySlot[] = [];
    const seenHour = new Set<string>();
    const dailyAgg = new Map<
      string,
      {
        minC: number;
        maxC: number;
        windMaxKmh: number;
        precipProbMax: number;
        repCode: number;
        repPriority: number;
      }
    >();

    let current: WeatherResponse['current'] = null;

    for (const item of series) {
      if (!item.time) continue;
      const ms = Date.parse(item.time);
      if (Number.isNaN(ms)) continue;
      const ist = getIstanbulClock(ms);
      const instant = item.data?.instant?.details;
      const tempC = Math.round(Number(instant?.air_temperature ?? 0));
      const windKmh = Math.round(Number(instant?.wind_speed ?? 0) * 3.6);
      const next1 = item.data?.next_1_hours;
      const next6 = item.data?.next_6_hours;
      const symbolCode = next1?.summary?.symbol_code || next6?.summary?.symbol_code;
      const precipMm = Number(
        next1?.details?.precipitation_amount ?? next6?.details?.precipitation_amount ?? 0
      );
      const weatherCode = metSymbolToWmo(symbolCode);
      const precipProb = estimateMetPrecipProb(symbolCode, precipMm);

      if (!current) {
        current = {
          tempC,
          weatherCode,
          conditionLabel: describeWmoCode(weatherCode),
          windKmh,
        };
      }

      const key = `${ist.dateStr}-${ist.hour}`;
      if (!seenHour.has(key)) {
        seenHour.add(key);
        hourly.push({
          dateStr: ist.dateStr,
          hour: ist.hour,
          tempC,
          weatherCode,
          conditionLabel: describeWmoCode(weatherCode),
          precipProb,
          windKmh,
        });
      }

      const existing = dailyAgg.get(ist.dateStr);
      const priority = ist.hour >= 11 && ist.hour <= 16 ? 2 : ist.hour >= 7 && ist.hour <= 22 ? 1 : 0;
      if (!existing) {
        dailyAgg.set(ist.dateStr, {
          minC: tempC,
          maxC: tempC,
          windMaxKmh: windKmh,
          precipProbMax: precipProb,
          repCode: weatherCode,
          repPriority: priority,
        });
      } else {
        existing.minC = Math.min(existing.minC, tempC);
        existing.maxC = Math.max(existing.maxC, tempC);
        existing.windMaxKmh = Math.max(existing.windMaxKmh, windKmh);
        existing.precipProbMax = Math.max(existing.precipProbMax, precipProb);
        if (priority >= existing.repPriority) {
          existing.repCode = weatherCode;
          existing.repPriority = priority;
        }
      }
    }

    const daily: WeatherDailyItem[] = Array.from(dailyAgg.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, agg]) => ({
        dateStr,
        weatherCode: agg.repCode,
        conditionLabel: describeWmoCode(agg.repCode),
        tempMinC: agg.minC,
        tempMaxC: agg.maxC,
        precipProbMax: agg.precipProbMax,
        windMaxKmh: agg.windMaxKmh,
      }));

    return {
      available: hourly.length > 0 && daily.length > 0,
      locationLabel: 'İzmir · Karşıyaka',
      fetchedAtMs: nowMs,
      current,
      daily,
      hourly,
    };
  }

  async function saveWeatherToDb(payload: WeatherResponse) {
    try {
      const serialized = JSON.stringify(payload);
      if (isPostgres) {
        await db.execute(
          "INSERT INTO settings (key, value) VALUES ('weather_cache_v1', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [serialized]
        );
      } else {
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('weather_cache_v1', ?)",
          [serialized]
        );
      }
    } catch {
      // Non-critical cache persistence
    }
  }

  async function loadWeatherFromDb(): Promise<WeatherResponse | null> {
    try {
      const row = await db.queryOne<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'weather_cache_v1'"
      );
      if (!row?.value) return null;
      const parsed = JSON.parse(row.value) as WeatherResponse;
      return parsed && parsed.available ? parsed : null;
    } catch {
      return null;
    }
  }

  async function fetchFreshWeather(now: number): Promise<WeatherResponse> {
    // 1. Try Open-Meteo when not on 429 cooldown
    if (now >= openMeteoCooldownUntilMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(KARSIYAKA_OPEN_METEO_URL, {
          signal: controller.signal,
          headers: { 'User-Agent': 'SoyakSiestaTenis/1.0' },
        });
        if (res.status === 429) {
          openMeteoCooldownUntilMs = now + OPEN_METEO_COOLDOWN_MS;
          console.warn('Open-Meteo rate-limited (429); switching to MET Norway fallback.');
        } else if (res.ok) {
          const parsed = parseOpenMeteoPayload(await res.json(), now);
          if (parsed.available) {
            weatherCache = { expiresAtMs: now + WEATHER_CACHE_TTL_MS, data: parsed };
            void saveWeatherToDb(parsed);
            return parsed;
          }
        }
      } catch (err) {
        openMeteoCooldownUntilMs = now + 10 * 60 * 1000;
        console.warn('Open-Meteo fetch failed, trying MET Norway fallback:', (err as Error)?.message);
      } finally {
        clearTimeout(timeout);
      }
    }

    // 2. Fallback provider: MET Norway Locationforecast (free, global ECMWF, separate rate limit)
    const metController = new AbortController();
    const metTimeout = setTimeout(() => metController.abort(), 5500);
    try {
      const metRes = await fetch(KARSIYAKA_MET_NO_URL, {
        signal: metController.signal,
        headers: {
          'User-Agent': 'SoyakSiestaTenis/1.0 (https://soyaksiestatenis.onrender.com)',
          Accept: 'application/json',
        },
      });
      if (metRes.ok) {
        const parsed = parseMetNoPayload(await metRes.json(), now);
        if (parsed.available) {
          weatherCache = { expiresAtMs: now + WEATHER_CACHE_TTL_MS, data: parsed };
          void saveWeatherToDb(parsed);
          return parsed;
        }
      } else {
        console.warn(`MET Norway weather fallback HTTP ${metRes.status}`);
      }
    } catch (err) {
      console.warn('MET Norway weather fallback failed:', (err as Error)?.message);
    } finally {
      clearTimeout(metTimeout);
    }

    // 3. Fallback to persisted DB / stale cache if still reasonably fresh (< 3 hours), else unavailable (client will try direct browser fetch)
    weatherFailureCooldownUntilMs = now + FAILURE_COOLDOWN_MS;
    const stale = weatherCache?.data ?? (await loadWeatherFromDb());
    if (stale && now - stale.fetchedAtMs < 3 * 60 * 60 * 1000) {
      weatherCache = { expiresAtMs: now + FAILURE_COOLDOWN_MS, data: stale };
      return stale;
    }

    return {
      available: false,
      locationLabel: 'İzmir · Karşıyaka',
      fetchedAtMs: now,
      current: null,
      daily: [],
      hourly: [],
    };
  }

  app.get('/api/weather', async (_req, res) => {
    const now = Date.now();
    if (weatherCache && weatherCache.expiresAtMs > now) {
      res.json(weatherCache.data);
      return;
    }

    if (!weatherCache) {
      const dbCached = await loadWeatherFromDb();
      if (dbCached && now - dbCached.fetchedAtMs < WEATHER_CACHE_TTL_MS) {
        weatherCache = {
          expiresAtMs: dbCached.fetchedAtMs + WEATHER_CACHE_TTL_MS,
          data: dbCached,
        };
        res.json(dbCached);
        return;
      }
    }

    if (now < weatherFailureCooldownUntilMs) {
      res.json(
        weatherCache?.data ?? {
          available: false,
          locationLabel: 'İzmir · Karşıyaka',
          fetchedAtMs: now,
          current: null,
          daily: [],
          hourly: [],
        }
      );
      return;
    }

    if (!weatherInFlight) {
      weatherInFlight = fetchFreshWeather(now).finally(() => {
        weatherInFlight = null;
      });
    }
    const result = await weatherInFlight;
    res.json(result);
  });

  // Mount Vite middleware in development, or serve built dist/ in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Tennis court reservation server listening on http://0.0.0.0:${port}`);

    if (isProd && process.env.DISABLE_KEEP_ALIVE !== 'true') {
      const externalBase = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '')
        .trim()
        .replace(/\/$/, '');
      if (externalBase.startsWith('https://') || externalBase.startsWith('http://')) {
        const keepAliveTimer = setInterval(() => {
          fetch(`${externalBase}/api/ping`, {
            method: 'GET',
            headers: { 'User-Agent': 'SoyakSiestaKeepAlive/1.0' },
            signal: AbortSignal.timeout(8000),
          }).catch(() => {});
        }, 13 * 60 * 1000);
        keepAliveTimer.unref?.();
      }
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
