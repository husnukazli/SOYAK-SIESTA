import type { PlayType, SlotEligibility } from '../shared/types.ts';
import { FREE_CANCEL_HOURS, LATE_BOOKING_FREE_CANCEL_HOURS } from '../shared/cancelPolicy.ts';

export { FREE_CANCEL_HOURS, LATE_BOOKING_FREE_CANCEL_HOURS };
export const COURT_OPEN_HOUR = 7;
export const COURT_CLOSE_HOUR = 23; // last slot starts at 22:00 and ends at 23:00
export const PRIME_HOURS = new Set([18, 19, 20]);
export const PRIME_OVERRIDE_HOUR = 15;
export const MAX_BOOKING_DAYS_AHEAD = 6;
export const LATE_CANCEL_WINDOW_DAYS = 15;
export const LATE_CANCEL_BAN_DAYS = 7;
export const VIOLATION_BAN_DAYS = 30;

export interface IstanbulClock {
  nowMs: number;
  dateStr: string;
  hour: number;
  minute: number;
  label: string;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Turkey (Europe/Istanbul) observes permanent UTC+3 year-round.
 */
export function getIstanbulClock(referenceMs: number = Date.now()): IstanbulClock {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(referenceMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  return {
    nowMs: referenceMs,
    dateStr,
    hour,
    minute,
    label: `${map.day}.${map.month}.${map.year} · ${pad2(hour)}:${pad2(minute)} (TSİ)`,
  };
}

export function getSlotBoundsMs(dateStr: string, hour: number): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${dateStr}T${pad2(hour)}:00:00+03:00`);
  const endMs = startMs + 60 * 60 * 1000;
  return { startMs, endMs };
}

export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const baseMs = Date.parse(`${dateStr}T12:00:00+03:00`);
  const shifted = getIstanbulClock(baseMs + deltaDays * 24 * 60 * 60 * 1000);
  return shifted.dateStr;
}

export function isValidDateStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = Date.parse(`${dateStr}T12:00:00+03:00`);
  return !Number.isNaN(parsed);
}

export function isPrimeHour(hour: number): boolean {
  return PRIME_HOURS.has(hour);
}

export interface ApartmentRuleContext {
  apartmentNo: string;
  banUntilMs: number | null;
  banReason: string | null;
  hasActiveUnfinishedBooking: boolean;
  hasSameDayBooking: boolean;
  hasAdjacentDayPrimeBooking: boolean;
}

export function evaluateSlotEligibility(params: {
  clock: IstanbulClock;
  targetDateStr: string;
  hour: number;
  slotReserved: boolean;
  apt: ApartmentRuleContext;
  playType?: PlayType;
}): SlotEligibility {
  const { clock, targetDateStr, hour, slotReserved, apt, playType } = params;
  const primeTime = isPrimeHour(hour);
  const soloTrainingAllowed = !primeTime;
  const { endMs } = getSlotBoundsMs(targetDateStr, hour);

  // Past or nearly finished current slot (< 5 mins left)
  if (endMs <= clock.nowMs + 5 * 60 * 1000) {
    return {
      bookable: false,
      reason: 'Bu saat dilimi sona ermiştir.',
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  // Booking horizon check (today .. today + 6 days)
  const maxDateStr = shiftDateStr(clock.dateStr, MAX_BOOKING_DAYS_AHEAD);
  if (targetDateStr < clock.dateStr || targetDateStr > maxDateStr) {
    return {
      bookable: false,
      reason: `Rezervasyonlar en fazla ${MAX_BOOKING_DAYS_AHEAD + 1} günlük takvim için açılır.`,
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  if (slotReserved) {
    return {
      bookable: false,
      reason: 'Bu saat dilimi başka bir daire tarafından rezerve edilmiştir.',
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  if (apt.banUntilMs && apt.banUntilMs > clock.nowMs) {
    const untilClock = getIstanbulClock(apt.banUntilMs);
    return {
      bookable: false,
      reason: `${apt.banReason || 'Rezervasyon kısıtlaması'} nedeniyle ${untilClock.label} tarihine kadar rezervasyon yapılamaz.`,
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  if (apt.hasActiveUnfinishedBooking) {
    return {
      bookable: false,
      reason: 'Mevcut rezervasyon saatiniz tamamlanmadan yeni rezervasyon oluşturulamaz.',
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  if (apt.hasSameDayBooking) {
    return {
      bookable: false,
      reason: 'Aynı gün içinde birden fazla rezervasyon yapılamaz.',
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  if (playType === 'solo_training' && primeTime) {
    return {
      bookable: false,
      reason: '18:00 - 21:00 yoğun saat aralığında bireysel antrenman rezervasyonu yapılamaz.',
      primeTime,
      primeOverrideUsed: false,
      soloTrainingAllowed,
    };
  }

  let primeOverrideUsed = false;
  if (primeTime && apt.hasAdjacentDayPrimeBooking) {
    const isTodayAfterCutoff = targetDateStr === clock.dateStr && clock.hour >= PRIME_OVERRIDE_HOUR;
    if (isTodayAfterCutoff) {
      primeOverrideUsed = true;
    } else {
      return {
        bookable: false,
        reason: `18:00 - 21:00 aralığında üst üste 2 gün rezervasyon yapılamaz. Boş ise bugün saat ${pad2(PRIME_OVERRIDE_HOUR)}:00 sonrasında yeniden rezerve edilebilir.`,
        primeTime,
        primeOverrideUsed: false,
        soloTrainingAllowed,
      };
    }
  }

  return {
    bookable: true,
    reason: null,
    primeTime,
    primeOverrideUsed,
    soloTrainingAllowed,
  };
}
