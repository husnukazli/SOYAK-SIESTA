export type PlayType = 'match' | 'solo_training';

export type ReservationStatus = 'active' | 'cancelled_ontime' | 'cancelled_late';

export type PenaltyType = 'late_cancellation' | 'non_resident_violation';

export type PenaltyAction = 'warning' | 'ban_7d' | 'ban_30d';

export type PartnerFormat = 'match' | 'training' | 'rally';

export type PartnerPostStatus = 'open' | 'matched' | 'closed';

export interface AuthSession {
  role: 'resident' | 'admin';
  apartmentNo?: string;
  token: string;
}

export interface ReservationItem {
  id: number;
  apartmentNo: string;
  dateStr: string;
  hour: number;
  startMs: number;
  endMs: number;
  playType: PlayType;
  status: ReservationStatus;
  createdAtMs: number;
  cancelledAtMs: number | null;
  lateCancel: boolean;
}

export interface PenaltyItem {
  id: number;
  apartmentNo: string;
  type: PenaltyType;
  action: PenaltyAction;
  reservationId: number | null;
  note: string;
  feeAmount: string | null;
  createdAtMs: number;
}

export interface ApartmentSummary {
  apartmentNo: string;
  residentLabel: string;
  hasPassword: boolean;
  visiblePasscode?: string | null;
  banUntilMs: number | null;
  banReason: string | null;
  lateCancelsLast15d: number;
  nonResidentViolations: number;
  activeReservation: ReservationItem | null;
}

export interface SlotEligibility {
  bookable: boolean;
  reason: string | null;
  primeTime: boolean;
  primeOverrideUsed: boolean;
  soloTrainingAllowed: boolean;
}

export interface ScheduleSlot {
  hour: number;
  label: string;
  primeTime: boolean;
  startMs: number;
  endMs: number;
  isPast: boolean;
  isCurrent: boolean;
  reservation: {
    id: number;
    apartmentNo: string;
    playType: PlayType;
    isOwn: boolean;
    createdAtMs: number;
  } | null;
  eligibility: SlotEligibility | null;
}

export interface ScheduleResponse {
  dateStr: string;
  todayStr: string;
  nowMs: number;
  nowIstanbulLabel: string;
  nowHour: number;
  courtStatus: {
    currentHour: number;
    currentHourLabel: string;
    isOperational: boolean;
    reservedBy: string | null;
    playType: PlayType | null;
    walkInAvailable: boolean;
  };
  slots: ScheduleSlot[];
  residentSummary: ApartmentSummary | null;
}

export interface ResidentPortalResponse {
  apartment: ApartmentSummary;
  reservations: ReservationItem[];
  penalties: PenaltyItem[];
  nowMs: number;
}

export interface AdminOverviewResponse {
  apartments: ApartmentSummary[];
  reservations: ReservationItem[];
  penalties: PenaltyItem[];
  nowMs: number;
  todayStr: string;
  databaseMode?: 'postgres' | 'sqlite';
}

export interface BackupApartmentRecord {
  apartmentNo: string;
  residentLabel: string;
  passcode: string | null;
  passwordHash: string | null;
  banUntilMs: number | null;
  banReason: string | null;
  createdAtMs: number;
}

export interface BackupPartnerPostRecord {
  id: number;
  apartmentNo: string;
  nickname: string;
  skillLevel: number;
  sessionFormat: PartnerFormat;
  dateStr: string;
  startHour: number;
  endHour: number;
  note: string | null;
  status: PartnerPostStatus;
  createdAtMs: number;
}

export interface BackupPartnerReplyRecord {
  id: number;
  postId: number;
  apartmentNo: string;
  nickname: string;
  message: string;
  createdAtMs: number;
}

export interface SystemBackupPayload {
  version: 1;
  app: 'soyaksiestatenis';
  exportedAtMs: number;
  exportedAtLabel: string;
  sourceDatabase: 'postgres' | 'sqlite';
  data: {
    apartments: BackupApartmentRecord[];
    reservations: ReservationItem[];
    penalties: PenaltyItem[];
    partnerPosts: BackupPartnerPostRecord[];
    partnerReplies: BackupPartnerReplyRecord[];
  };
}

export interface PartnerReplyItem {
  id: number;
  postId: number;
  nickname: string;
  message: string;
  createdAtMs: number;
  isOwn: boolean;
}

export interface PartnerPostItem {
  id: number;
  nickname: string;
  skillLevel: number;
  sessionFormat: PartnerFormat;
  dateStr: string;
  startHour: number;
  endHour: number;
  note: string | null;
  status: PartnerPostStatus;
  createdAtMs: number;
  isOwn: boolean;
  replies: PartnerReplyItem[];
}

export interface PartnerBoardResponse {
  posts: PartnerPostItem[];
  todayStr: string;
  nowMs: number;
}

export type RealtimeEvent =
  | {
      type: 'connected';
      activeConnections: number;
      nowMs: number;
    }
  | {
      type: 'schedule:changed';
      action: 'booked' | 'cancelled';
      dateStr: string;
      hour: number;
      apartmentNo: string;
      reservationId: number;
    }
  | {
      type: 'apartment:changed';
      apartmentNo: string;
    }
  | {
      type: 'directory:changed';
    }
  | {
      type: 'partner:changed';
    };

export interface WeatherHourlySlot {
  dateStr: string;
  hour: number;
  tempC: number;
  weatherCode: number;
  conditionLabel: string;
  precipProb: number;
  windKmh: number;
}

export interface WeatherDailyItem {
  dateStr: string;
  weatherCode: number;
  conditionLabel: string;
  tempMinC: number;
  tempMaxC: number;
  precipProbMax: number;
  windMaxKmh: number;
}

export interface WeatherResponse {
  available: boolean;
  locationLabel: string;
  fetchedAtMs: number;
  current: {
    tempC: number;
    weatherCode: number;
    conditionLabel: string;
    windKmh: number;
  } | null;
  daily: WeatherDailyItem[];
  hourly: WeatherHourlySlot[];
}
