import type {
  AdminOverviewResponse,
  AuthSession,
  PartnerBoardResponse,
  PartnerFormat,
  PartnerPostItem,
  PartnerPostStatus,
  PartnerReplyItem,
  PlayType,
  ReservationItem,
  ResidentPortalResponse,
  ScheduleResponse,
  SystemBackupPayload,
  WeatherResponse,
} from '../shared/types';
import { KARSIYAKA_OPEN_METEO_URL, parseOpenMeteoPayload } from '../shared/weather';

export interface AuthStatusResponse {
  adminSetupNeeded: boolean;
  apartments: {
    apartmentNo: string;
    residentLabel: string;
    hasPassword: boolean;
  }[];
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'İşlem sırasında bir hata oluştu.';
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

export const api = {
  getAuthStatus: () => apiFetch<AuthStatusResponse>('/api/auth/status', { cache: 'no-store' }),

  setupAdmin: (passcode: string) =>
    apiFetch<{ token: string; role: 'admin' }>('/api/auth/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),

  loginAdmin: (passcode: string, rememberMe = false) =>
    apiFetch<{ token: string; role: 'admin' }>('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ passcode, rememberMe }),
    }),

  loginResident: (apartmentNo: string, password: string, rememberMe = false) =>
    apiFetch<{ token: string; role: 'resident'; apartmentNo: string }>(
      '/api/auth/resident/login',
      {
        method: 'POST',
        body: JSON.stringify({ apartmentNo, password, rememberMe }),
      }
    ),

  restoreSession: () =>
    apiFetch<{ session: Omit<AuthSession, 'token'>; token?: string }>('/api/auth/me', {
      cache: 'no-store',
    }),

  logoutSession: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  verifySession: (token: string) =>
    apiFetch<{ session: Omit<AuthSession, 'token'> }>('/api/auth/me', { cache: 'no-store' }, token),

  getSchedule: (dateStr?: string, token?: string | null) => {
    const query = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
    return apiFetch<ScheduleResponse>(`/api/schedule${query}`, {}, token);
  },

  getWeather: async (): Promise<WeatherResponse> => {
    const serverWeather = await apiFetch<WeatherResponse>('/api/weather');
    if (serverWeather.available) {
      return serverWeather;
    }
    try {
      const directRes = await fetch(KARSIYAKA_OPEN_METEO_URL);
      if (directRes.ok) {
        return parseOpenMeteoPayload(await directRes.json());
      }
    } catch {
      // Ignore direct browser weather failure
    }
    return serverWeather;
  },

  getResidentPortal: (token: string) =>
    apiFetch<ResidentPortalResponse>('/api/resident/portal', {}, token),

  createReservation: (
    token: string,
    payload: {
      dateStr: string;
      hour: number;
      playType: PlayType;
      residentConfirmed: boolean;
    }
  ) =>
    apiFetch<{ reservation: ReservationItem; primeOverrideUsed: boolean }>(
      '/api/reservations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    ),

  cancelReservation: (token: string, reservationId: number) =>
    apiFetch<{
      lateCancel: boolean;
      penaltyAction: 'warning' | 'ban_7d' | null;
      banUntilMs: number | null;
      message: string;
    }>(
      `/api/reservations/${reservationId}/cancel`,
      { method: 'POST' },
      token
    ),

  getAdminOverview: (token: string) =>
    apiFetch<AdminOverviewResponse>('/api/admin/overview', {}, token),

  getAdminBackup: (token: string) =>
    apiFetch<SystemBackupPayload>('/api/admin/backup', {}, token),

  restoreAdminBackup: (token: string, backup: SystemBackupPayload) =>
    apiFetch<{
      ok: boolean;
      counts: {
        apartments: number;
        reservations: number;
        penalties: number;
        partnerPosts: number;
        partnerReplies: number;
      };
    }>(
      '/api/admin/restore',
      {
        method: 'POST',
        body: JSON.stringify(backup),
      },
      token
    ),

  adminAddApartment: (
    token: string,
    payload: { apartmentNo: string; residentLabel?: string; password?: string }
  ) =>
    apiFetch<{ apartmentNo: string; residentLabel: string; issuedPasscode: string }>(
      '/api/admin/apartments',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    ),

  adminDeleteApartment: (token: string, apartmentNo: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/admin/apartments/${encodeURIComponent(apartmentNo)}`,
      { method: 'DELETE' },
      token
    ),

  adminCleanupUnassigned: (token: string) =>
    apiFetch<{ deletedCount: number }>(
      '/api/admin/apartments/unassigned/cleanup',
      { method: 'DELETE' },
      token
    ),

  adminSetApartmentPassword: (token: string, apartmentNo: string, password?: string) =>
    apiFetch<{ apartmentNo: string; issuedPasscode: string }>(
      `/api/admin/apartments/${encodeURIComponent(apartmentNo)}/password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      },
      token
    ),

  adminBatchPasswords: (token: string) =>
    apiFetch<{ issued: { apartmentNo: string; passcode: string }[] }>(
      '/api/admin/apartments/batch-passwords',
      { method: 'POST' },
      token
    ),

  adminLogViolation: (
    token: string,
    payload: {
      apartmentNo: string;
      reservationId?: number | null;
      note?: string;
      feeAmount?: string;
    }
  ) =>
    apiFetch<{
      action: 'warning' | 'ban_30d';
      banUntilMs: number | null;
      note: string;
      feeAmount: string | null;
    }>(
      '/api/admin/violations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    ),

  adminLiftBan: (token: string, apartmentNo: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/admin/apartments/${encodeURIComponent(apartmentNo)}/lift-ban`,
      { method: 'POST' },
      token
    ),

  adminCancelReservation: (token: string, reservationId: number) =>
    apiFetch<{ ok: boolean }>(
      `/api/admin/reservations/${reservationId}/cancel`,
      { method: 'POST' },
      token
    ),

  getPartnerBoard: (token?: string | null) =>
    apiFetch<PartnerBoardResponse>('/api/partners', {}, token),

  createPartnerPost: (
    token: string,
    payload: {
      nickname: string;
      skillLevel: number;
      sessionFormat: PartnerFormat;
      dateStr: string;
      startHour: number;
      endHour: number;
      note?: string;
    }
  ) =>
    apiFetch<{ post: PartnerPostItem }>(
      '/api/partners',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    ),

  replyPartnerPost: (
    token: string,
    postId: number,
    payload: { nickname: string; message: string }
  ) =>
    apiFetch<{ reply: PartnerReplyItem | null }>(
      `/api/partners/${postId}/replies`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    ),

  updatePartnerPostStatus: (token: string, postId: number, status: PartnerPostStatus) =>
    apiFetch<{ ok: boolean; status: PartnerPostStatus }>(
      `/api/partners/${postId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      token
    ),

  deletePartnerPost: (token: string, postId: number) =>
    apiFetch<{ ok: boolean }>(
      `/api/partners/${postId}`,
      { method: 'DELETE' },
      token
    ),
};

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatHourRange(hour: number): string {
  return `${pad2(hour)}:00 - ${pad2(hour + 1)}:00`;
}

export function getTodayIstanbulDateStr(referenceMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(referenceMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatIstanbulDateTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

export function formatTurkishDateShort(dateStr: string): {
  weekday: string;
  dayMonth: string;
} {
  const safeDate = dateStr || getTodayIstanbulDateStr();
  const ms = Date.parse(`${safeDate}T12:00:00+03:00`);
  if (Number.isNaN(ms)) {
    return { weekday: '—', dayMonth: safeDate };
  }
  const d = new Date(ms);
  const weekday = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
  }).format(d);
  const dayMonth = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: 'short',
  }).format(d);
  return { weekday, dayMonth };
}

export function formatTurkishDateFull(dateStr: string): string {
  const safeDate = dateStr || getTodayIstanbulDateStr();
  const ms = Date.parse(`${safeDate}T12:00:00+03:00`);
  if (Number.isNaN(ms)) return safeDate;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(new Date(ms));
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const safeDate = dateStr || getTodayIstanbulDateStr();
  const baseMs = Date.parse(`${safeDate}T12:00:00+03:00`);
  if (Number.isNaN(baseMs)) return getTodayIstanbulDateStr();
  return getTodayIstanbulDateStr(baseMs + days * 24 * 60 * 60 * 1000);
}

export function formatRemainingDuration(ms: number): string {
  if (ms <= 0) return 'Süre doldu';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days} gün ${hours} saat`;
  if (hours > 0) return `${hours} saat ${mins} dk`;
  return `${mins} dakika`;
}
