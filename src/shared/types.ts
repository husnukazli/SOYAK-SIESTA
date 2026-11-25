export type PlayType = 'match' | 'solo_training';

export type ReservationStatus = 'active' | 'cancelled_ontime' | 'cancelled_late';

export type PenaltyType = 'late_cancellation' | 'non_resident_violation';

export type PenaltyAction = 'warning' | 'ban_7d' | 'ban_30d';

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
  sixteenHourOverrideUsed: boolean;
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
    };
