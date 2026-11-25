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
  mapPenaltyRow,
  mapReservationRow,
  type RawPenaltyRow,
  type RawReservationRow,
  signSessionToken,
  verifyPasscodeHash,
  verifySessionToken,
  withTransaction,
} from './src/server/db.ts';
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  evaluateSlotEligibility,
  FREE_CANCEL_HOURS,
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
import type {
  AdminOverviewResponse,
  AuthSession,
  PlayType,
  RealtimeEvent,
  ResidentPortalResponse,
  ScheduleResponse,
  ScheduleSlot,
} from './src/shared/types.ts';

interface AuthenticatedRequest extends Request {
  session?: Omit<AuthSession, 'token'>;
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

  const app = express();
  app.use(express.json({ limit: '100kb' }));

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

  // Verify current Bearer session
  app.get('/api/auth/me', (req, res) => {
    const session = parseBearerSession(req);
    if (!session) {
      res.status(401).json({ error: 'Aktif oturum bulunamadı.' });
      return;
    }
    res.json({ session });
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

  // Resident login by apartment number + assigned password
  app.post('/api/auth/resident/login', async (req, res) => {
    try {
      const apartmentNo =
        typeof req.body?.apartmentNo === 'string' ? req.body.apartmentNo.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

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

      const token = signSessionToken({ role: 'resident', apartmentNo: row.apartment_no });
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
          sixteenHourOverrideUsed: eligibility.sixteenHourOverrideUsed,
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
        db.queryAll<RawReservationRow>('SELECT * FROM reservations ORDER BY start_ms DESC LIMIT 100'),
        db.queryAll<RawPenaltyRow>('SELECT * FROM penalties ORDER BY created_at_ms DESC LIMIT 100'),
      ]);

      const payload: AdminOverviewResponse = {
        apartments,
        reservations: reservationRows.map(mapReservationRow),
        penalties: penaltyRows.map(mapPenaltyRow),
        nowMs: clock.nowMs,
        todayStr: clock.dateStr,
      };
      res.json(payload);
    } catch (err) {
      console.error('Admin overview error:', err);
      res.status(500).json({ error: 'Yönetim verileri yüklenemedi.' });
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
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
