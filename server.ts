import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  constantTimeEqualStrings,
  db,
  generateReadablePasscode,
  getAllApartmentSummaries,
  getApartmentRuleContext,
  getApartmentSummary,
  getClockNow,
  getEnvAdminPasscode,
  getStoredAdminHash,
  hashPasscode,
  isAdminSetupNeeded,
  mapPenaltyRow,
  mapReservationRow,
  signSessionToken,
  verifyPasscodeHash,
  verifySessionToken,
} from './src/server/db.js';
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
} from './src/server/rules.js';
import type {
  AdminOverviewResponse,
  AuthSession,
  PlayType,
  RealtimeEvent,
  ResidentPortalResponse,
  ScheduleResponse,
  ScheduleSlot,
} from './src/shared/types.js';

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

async function startServer() {
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
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Auth status & apartment directory (never exposes password hashes)
  app.get('/api/auth/status', (_req, res) => {
    const apartments = getAllApartmentSummaries().map((a) => ({
      apartmentNo: a.apartmentNo,
      residentLabel: a.residentLabel,
      hasPassword: a.hasPassword,
    }));
    res.json({
      adminSetupNeeded: isAdminSetupNeeded(),
      apartments,
    });
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
  app.post('/api/auth/admin/setup', (req, res) => {
    if (getEnvAdminPasscode() || getStoredAdminHash()) {
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
    const result = db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_passcode_hash', ?)")
      .run(hash);

    if (result.changes === 0) {
      res.status(409).json({
        error: 'Yönetici şifresi zaten tanımlanmış.',
      });
      return;
    }

    const token = signSessionToken({ role: 'admin' });
    res.json({ token, role: 'admin' });
  });

  // Admin login
  app.post('/api/auth/admin/login', (req, res) => {
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
      const storedHash = getStoredAdminHash();
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
  });

  // Resident login by apartment number + assigned password
  app.post('/api/auth/resident/login', (req, res) => {
    const apartmentNo =
      typeof req.body?.apartmentNo === 'string' ? req.body.apartmentNo.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    if (!apartmentNo || !password) {
      res.status(400).json({ error: 'Daire numarası ve şifre gereklidir.' });
      return;
    }

    const row = db
      .prepare('SELECT apartment_no, password_hash FROM apartments WHERE apartment_no = ?')
      .get(apartmentNo) as { apartment_no: string; password_hash: string | null } | undefined;

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
  });

  // Public + authenticated daily court schedule
  app.get('/api/schedule', (req, res) => {
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
      ? getApartmentRuleContext(viewerAptNo, dateStr, clock.nowMs)
      : null;

    const dayReservations = db
      .prepare("SELECT * FROM reservations WHERE date_str = ? AND status = 'active'")
      .all(dateStr) as Parameters<typeof mapReservationRow>[0][];

    const byHour = new Map<number, ReturnType<typeof mapReservationRow>>();
    for (const row of dayReservations) {
      byHour.set(row.hour, mapReservationRow(row));
    }

    // Current live court status (for today at clock.hour)
    const todayRows =
      dateStr === clock.dateStr
        ? dayReservations
        : (db
            .prepare("SELECT * FROM reservations WHERE date_str = ? AND status = 'active'")
            .all(clock.dateStr) as Parameters<typeof mapReservationRow>[0][]);
    const currentSlotRow = todayRows.find((r) => r.hour === clock.hour);
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
  });

  // Resident personal portal (active booking, history, penalties)
  app.get('/api/resident/portal', requireAuth('resident'), (req: AuthenticatedRequest, res) => {
    const apartmentNo = req.session!.apartmentNo!;
    const clock = getClockNow();
    const apartment = getApartmentSummary(apartmentNo, clock.nowMs);
    if (!apartment) {
      res.status(404).json({ error: 'Daire kaydı bulunamadı.' });
      return;
    }

    const reservationRows = db
      .prepare('SELECT * FROM reservations WHERE apartment_no = ? ORDER BY start_ms DESC LIMIT 50')
      .all(apartmentNo) as Parameters<typeof mapReservationRow>[0][];

    const penaltyRows = db
      .prepare('SELECT * FROM penalties WHERE apartment_no = ? ORDER BY created_at_ms DESC LIMIT 50')
      .all(apartmentNo) as Parameters<typeof mapPenaltyRow>[0][];

    const payload: ResidentPortalResponse = {
      apartment,
      reservations: reservationRows.map(mapReservationRow),
      penalties: penaltyRows.map(mapPenaltyRow),
      nowMs: clock.nowMs,
    };
    res.json(payload);
  });

  // Create reservation (enforces all court regulation rules inside an atomic transaction)
  app.post('/api/reservations', requireAuth('resident'), (req: AuthenticatedRequest, res) => {
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
      const created = db.transaction(() => {
        const aptCtx = getApartmentRuleContext(apartmentNo, dateStr, clock.nowMs);
        if (!aptCtx) {
          throw { status: 404, message: 'Daire kaydı bulunamadı.' };
        }

        const existingSlot = db
          .prepare(
            "SELECT id FROM reservations WHERE date_str = ? AND hour = ? AND status = 'active'"
          )
          .get(dateStr, hour) as { id: number } | undefined;

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
        const info = db
          .prepare(
            `INSERT INTO reservations
             (apartment_no, date_str, hour, start_ms, end_ms, play_type, status, created_at_ms, cancelled_at_ms, late_cancel)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, 0)`
          )
          .run(apartmentNo, dateStr, hour, startMs, endMs, playType, clock.nowMs);

        const row = db
          .prepare('SELECT * FROM reservations WHERE id = ?')
          .get(info.lastInsertRowid) as Parameters<typeof mapReservationRow>[0];

        return {
          reservation: mapReservationRow(row),
          sixteenHourOverrideUsed: eligibility.sixteenHourOverrideUsed,
        };
      })();

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
      // Handle SQLite unique constraint collision
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Bu saat dilimi az önce başka bir daire tarafından rezerve edildi.' });
        return;
      }
      res.status(500).json({ error: 'Rezervasyon oluşturulurken bir hata oluştu.' });
    }
  });

  // Cancel reservation (enforces 4-hour cutoff & 15-day repeat late cancellation 1-week ban)
  app.post('/api/reservations/:id/cancel', requireAuth('resident'), (req: AuthenticatedRequest, res) => {
    const apartmentNo = req.session!.apartmentNo!;
    const resId = Number(req.params.id);
    if (!Number.isInteger(resId) || resId <= 0) {
      res.status(400).json({ error: 'Geçersiz rezervasyon numarası.' });
      return;
    }

    const clock = getClockNow();

    try {
      const outcome = db.transaction(() => {
        const row = db
          .prepare('SELECT * FROM reservations WHERE id = ?')
          .get(resId) as Parameters<typeof mapReservationRow>[0] | undefined;

        if (!row) {
          throw { status: 404, message: 'Rezervasyon bulunamadı.' };
        }
        if (row.apartment_no !== apartmentNo) {
          throw { status: 403, message: 'Yalnızca kendi dairenize ait rezervasyonu iptal edebilirsiniz.' };
        }
        if (row.status !== 'active') {
          throw { status: 400, message: 'Bu rezervasyon zaten iptal edilmiş.' };
        }
        if (row.start_ms <= clock.nowMs) {
          throw {
            status: 400,
            message: 'Başlangıç saati geçmiş veya başlamış bir rezervasyon iptal edilemez.',
          };
        }

        const hoursUntilStart = (row.start_ms - clock.nowMs) / (60 * 60 * 1000);
        const isLate = hoursUntilStart < FREE_CANCEL_HOURS;

        if (!isLate) {
          db.prepare(
            "UPDATE reservations SET status = 'cancelled_ontime', cancelled_at_ms = ?, late_cancel = 0 WHERE id = ?"
          ).run(clock.nowMs, resId);

          return {
            lateCancel: false,
            penaltyAction: null as 'warning' | 'ban_7d' | null,
            banUntilMs: null as number | null,
            message: 'Rezervasyon 4 saatten uzun süre kala ücretsiz olarak iptal edildi.',
            cancelledReservation: { dateStr: row.date_str, hour: row.hour },
          };
        }

        // Late cancellation (< 4 hours remaining)
        const cutoff15d = clock.nowMs - LATE_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const priorLateCountRow = db
          .prepare(
            "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'late_cancellation' AND created_at_ms >= ?"
          )
          .get(apartmentNo, cutoff15d) as { cnt: number };

        const isRepeat = priorLateCountRow.cnt >= 1;
        const action = isRepeat ? 'ban_7d' : 'warning';
        const note = isRepeat
          ? `15 günlük süreç içinde tekrarlanan geç iptal (${row.date_str} ${pad2(row.hour)}:00). 1 haftalık rezervasyon hakkı iptali uygulandı.`
          : `15 günlük süreç içinde ilk geç iptal (${row.date_str} ${pad2(row.hour)}:00). Uyarı verildi; tekrarı halinde 1 hafta rezervasyon hakkı iptal edilecektir.`;

        db.prepare(
          "UPDATE reservations SET status = 'cancelled_late', cancelled_at_ms = ?, late_cancel = 1 WHERE id = ?"
        ).run(clock.nowMs, resId);

        db.prepare(
          `INSERT INTO penalties (apartment_no, type, action, reservation_id, note, fee_amount, created_at_ms)
           VALUES (?, 'late_cancellation', ?, ?, ?, NULL, ?)`
        ).run(apartmentNo, action, resId, note, clock.nowMs);

        let banUntilMs: number | null = null;
        if (isRepeat) {
          banUntilMs = clock.nowMs + LATE_CANCEL_BAN_DAYS * 24 * 60 * 60 * 1000;
          const aptRow = db
            .prepare('SELECT ban_until_ms FROM apartments WHERE apartment_no = ?')
            .get(apartmentNo) as { ban_until_ms: number | null };
          const effectiveBanUntil = Math.max(aptRow.ban_until_ms ?? 0, banUntilMs);
          db.prepare('UPDATE apartments SET ban_until_ms = ?, ban_reason = ? WHERE apartment_no = ?').run(
            effectiveBanUntil,
            '15 gün içinde tekrarlanan geç iptal cezası (1 hafta)',
            apartmentNo
          );
          banUntilMs = effectiveBanUntil;
        }

        return {
          lateCancel: true,
          penaltyAction: action,
          banUntilMs,
          message: note,
          cancelledReservation: { dateStr: row.date_str, hour: row.hour },
        };
      })();

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
      res.status(500).json({ error: 'İptal işlemi sırasında hata oluştu.' });
    }
  });

  // --- ADMIN ROUTES ---

  app.get('/api/admin/overview', requireAuth('admin'), (_req, res) => {
    const clock = getClockNow();
    const apartments = getAllApartmentSummaries(clock.nowMs);

    const reservationRows = db
      .prepare('SELECT * FROM reservations ORDER BY start_ms DESC LIMIT 100')
      .all() as Parameters<typeof mapReservationRow>[0][];

    const penaltyRows = db
      .prepare('SELECT * FROM penalties ORDER BY created_at_ms DESC LIMIT 100')
      .all() as Parameters<typeof mapPenaltyRow>[0][];

    const payload: AdminOverviewResponse = {
      apartments,
      reservations: reservationRows.map(mapReservationRow),
      penalties: penaltyRows.map(mapPenaltyRow),
      nowMs: clock.nowMs,
      todayStr: clock.dateStr,
    };
    res.json(payload);
  });

  // Add a new apartment unit
  app.post('/api/admin/apartments', requireAuth('admin'), (req, res) => {
    const apartmentNo =
      typeof req.body?.apartmentNo === 'string' ? req.body.apartmentNo.trim() : '';
    const residentLabelRaw =
      typeof req.body?.residentLabel === 'string' ? req.body.residentLabel.trim() : '';
    const passwordRaw =
      typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    if (!apartmentNo || apartmentNo.length > 20 || !/^[A-Za-z0-9-]+$/.test(apartmentNo)) {
      res.status(400).json({
        error: 'Geçerli bir daire numarası girin (harf, rakam veya tire, en fazla 20 karakter).',
      });
      return;
    }

    const existing = db
      .prepare('SELECT apartment_no FROM apartments WHERE apartment_no = ?')
      .get(apartmentNo);
    if (existing) {
      res.status(409).json({ error: `Daire ${apartmentNo} zaten kayıtlı.` });
      return;
    }

    if (passwordRaw && passwordRaw.length < 4) {
      res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
      return;
    }

    const generated = passwordRaw || generateReadablePasscode(8);
    const hash = hashPasscode(generated);
    const residentLabel = residentLabelRaw || `Daire ${apartmentNo}`;

    db.prepare(
      'INSERT INTO apartments (apartment_no, resident_label, password_hash, ban_until_ms, ban_reason, created_at_ms) VALUES (?, ?, ?, NULL, NULL, ?)'
    ).run(apartmentNo, residentLabel, hash, Date.now());

    broadcastEvent({ type: 'directory:changed' });

    res.status(201).json({
      apartmentNo,
      residentLabel,
      issuedPasscode: generated,
    });
  });

  // Assign or reset a single apartment's passcode
  app.post('/api/admin/apartments/:apartmentNo/password', requireAuth('admin'), (req, res) => {
    const apartmentNo = req.params.apartmentNo.trim();
    const customPassword =
      typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    const apt = db
      .prepare('SELECT apartment_no FROM apartments WHERE apartment_no = ?')
      .get(apartmentNo);
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

    db.prepare('UPDATE apartments SET password_hash = ? WHERE apartment_no = ?').run(
      hash,
      apartmentNo
    );

    broadcastEvent({ type: 'directory:changed' });

    res.json({
      apartmentNo,
      issuedPasscode,
    });
  });

  // Batch-assign passcodes to all apartments without a passcode yet
  app.post('/api/admin/apartments/batch-passwords', requireAuth('admin'), (_req, res) => {
    const missingRows = db
      .prepare('SELECT apartment_no FROM apartments WHERE password_hash IS NULL')
      .all() as { apartment_no: string }[];

    if (missingRows.length === 0) {
      res.json({ issued: [] });
      return;
    }

    const updateStmt = db.prepare('UPDATE apartments SET password_hash = ? WHERE apartment_no = ?');
    const issued: { apartmentNo: string; passcode: string }[] = [];

    const tx = db.transaction(() => {
      for (const row of missingRows) {
        const passcode = generateReadablePasscode(8);
        const hash = hashPasscode(passcode);
        updateStmt.run(hash, row.apartment_no);
        issued.push({ apartmentNo: row.apartment_no, passcode });
      }
    });
    tx();

    broadcastEvent({ type: 'directory:changed' });

    res.json({ issued });
  });

  // Record a non-resident court usage violation (1st = warning, 2nd+ = 1 month ban + optional fee)
  app.post('/api/admin/violations', requireAuth('admin'), (req, res) => {
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

    const apt = db
      .prepare('SELECT apartment_no, ban_until_ms FROM apartments WHERE apartment_no = ?')
      .get(apartmentNo) as { apartment_no: string; ban_until_ms: number | null } | undefined;

    if (!apt) {
      res.status(404).json({ error: 'Daire bulunamadı.' });
      return;
    }

    const clock = getClockNow();

    const outcome = db.transaction(() => {
      const priorRow = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM penalties WHERE apartment_no = ? AND type = 'non_resident_violation'"
        )
        .get(apartmentNo) as { cnt: number };

      const isRepeat = priorRow.cnt >= 1;
      const action = isRepeat ? 'ban_30d' : 'warning';
      const defaultNote = isRepeat
        ? 'Daire sakini olmadan tekrarlanan kort kullanımı tespit edildi. 1 aylık rezervasyon hakkı iptal edildi.'
        : 'Kortu kullanan kişiler arasında daire sakini bulunmadığı tespit edildi. İlk tespit uyarısı verildi.';
      const note = noteRaw ? `${noteRaw} (${isRepeat ? 'Tekrar ihlal — 1 ay kısıtlama' : 'İlk tespit — Uyarı'})` : defaultNote;
      const feeAmount = isRepeat && feeRaw ? feeRaw : null;

      db.prepare(
        `INSERT INTO penalties (apartment_no, type, action, reservation_id, note, fee_amount, created_at_ms)
         VALUES (?, 'non_resident_violation', ?, ?, ?, ?, ?)`
      ).run(
        apartmentNo,
        action,
        reservationId && Number.isInteger(reservationId) ? reservationId : null,
        note,
        feeAmount,
        clock.nowMs
      );

      let banUntilMs: number | null = null;
      if (isRepeat) {
        banUntilMs = clock.nowMs + VIOLATION_BAN_DAYS * 24 * 60 * 60 * 1000;
        const effectiveBanUntil = Math.max(apt.ban_until_ms ?? 0, banUntilMs);
        const banReason = feeAmount
          ? `Daire sakini ihlali (1 ay kısıtlama · Ücretli ceza: ${feeAmount})`
          : 'Daire sakini olmadan tekrarlanan kort kullanımı (1 ay kısıtlama)';
        db.prepare('UPDATE apartments SET ban_until_ms = ?, ban_reason = ? WHERE apartment_no = ?').run(
          effectiveBanUntil,
          banReason,
          apartmentNo
        );
        banUntilMs = effectiveBanUntil;
      }

      return { action, banUntilMs, note, feeAmount };
    })();

    broadcastEvent({ type: 'apartment:changed', apartmentNo });

    res.status(201).json(outcome);
  });

  // Management override to lift an active apartment ban
  app.post('/api/admin/apartments/:apartmentNo/lift-ban', requireAuth('admin'), (req, res) => {
    const apartmentNo = req.params.apartmentNo.trim();
    const info = db
      .prepare('UPDATE apartments SET ban_until_ms = NULL, ban_reason = NULL WHERE apartment_no = ?')
      .run(apartmentNo);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Daire bulunamadı.' });
      return;
    }
    broadcastEvent({ type: 'apartment:changed', apartmentNo });
    res.json({ ok: true });
  });

  // Management cancellation of a reservation (without automated resident late penalty)
  app.post('/api/admin/reservations/:id/cancel', requireAuth('admin'), (req, res) => {
    const resId = Number(req.params.id);
    if (!Number.isInteger(resId) || resId <= 0) {
      res.status(400).json({ error: 'Geçersiz rezervasyon numarası.' });
      return;
    }
    const clock = getClockNow();
    const targetRow = db
      .prepare('SELECT apartment_no, date_str, hour FROM reservations WHERE id = ? AND status = \'active\'')
      .get(resId) as { apartment_no: string; date_str: string; hour: number } | undefined;
    if (!targetRow) {
      res.status(404).json({ error: 'Aktif rezervasyon bulunamadı.' });
      return;
    }
    db.prepare(
      "UPDATE reservations SET status = 'cancelled_ontime', cancelled_at_ms = ?, late_cancel = 0 WHERE id = ? AND status = 'active'"
    ).run(clock.nowMs, resId);
    broadcastEvent({
      type: 'schedule:changed',
      action: 'cancelled',
      dateStr: targetRow.date_str,
      hour: targetRow.hour,
      apartmentNo: targetRow.apartment_no,
      reservationId: resId,
    });
    res.json({ ok: true });
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
