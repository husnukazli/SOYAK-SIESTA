import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { AdminConsoleView } from './components/AdminConsoleView';
import { AuthModal } from './components/AuthModal';
import { BookingModal } from './components/BookingModal';
import { CancelModal } from './components/CancelModal';
import { CourtScheduleView } from './components/CourtScheduleView';
import { Header, type ActiveTab } from './components/Header';
import { ResidentPortalView } from './components/ResidentPortalView';
import { RulesView } from './components/RulesView';
import {
  api,
  ApiError,
  formatHourRange,
  getTodayIstanbulDateStr,
  type AuthStatusResponse,
} from './lib/api';
import { useCourtRealtime } from './lib/realtime';
import type {
  AuthSession,
  RealtimeEvent,
  ReservationItem,
  ScheduleResponse,
  ScheduleSlot,
} from './shared/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('schedule');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIstanbulDateStr());
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState<boolean>(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [bookingSlot, setBookingSlot] = useState<ScheduleSlot | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    id: number;
    dateStr: string;
    hour: number;
    startMs: number;
  } | null>(null);

  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);
  const [portalRefreshTick, setPortalRefreshTick] = useState(0);

  const loadAuthStatus = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
    } catch {
      // Auth status is retried on next navigation or modal open
    }
  }, []);

  const loadSchedule = useCallback(
    async (dateOverride?: string) => {
      setScheduleLoading(true);
      setScheduleError(null);
      try {
        const targetDate = dateOverride ?? (selectedDate || undefined);
        const token = session?.role === 'resident' ? session.token : null;
        const data = await api.getSchedule(targetDate, token);
        setSchedule(data);
        if (!selectedDate) {
          setSelectedDate(data.dateStr);
        }
      } catch (err) {
        setScheduleError(
          err instanceof ApiError ? err.message : 'Kort programı yüklenirken hata oluştu.'
        );
      } finally {
        setScheduleLoading(false);
      }
    },
    [selectedDate, session]
  );

  useEffect(() => {
    loadAuthStatus();
  }, [loadAuthStatus]);

  useEffect(() => {
    loadSchedule();
    // Keep server clock / hour transitions aligned even without mutations
    const timer = setInterval(() => {
      loadSchedule();
    }, 60_000);
    return () => clearInterval(timer);
  }, [loadSchedule]);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'schedule:changed') {
        loadSchedule();
        setPortalRefreshTick((n) => n + 1);
        const isOwnAction =
          session?.role === 'resident' && session.apartmentNo === event.apartmentNo;
        if (!isOwnAction && (!selectedDate || event.dateStr === selectedDate)) {
          const actionLabel =
            event.action === 'booked'
              ? `Daire ${event.apartmentNo} tarafından rezerve edildi`
              : `Daire ${event.apartmentNo} rezervasyonunu iptal etti (saat açıldı)`;
          setToast({
            message: `${event.dateStr} · ${formatHourRange(event.hour)} ${actionLabel}.`,
            tone: 'success',
          });
        }
      } else if (event.type === 'apartment:changed') {
        loadSchedule();
        setPortalRefreshTick((n) => n + 1);
      } else if (event.type === 'directory:changed') {
        loadAuthStatus();
        setPortalRefreshTick((n) => n + 1);
      }
    },
    [loadAuthStatus, loadSchedule, selectedDate, session]
  );

  const handleReconnectSync = useCallback(() => {
    loadAuthStatus();
    loadSchedule();
    setPortalRefreshTick((n) => n + 1);
  }, [loadAuthStatus, loadSchedule]);

  useCourtRealtime({
    onEvent: handleRealtimeEvent,
    onReconnectSync: handleReconnectSync,
  });

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === 'admin' && session?.role === 'resident') {
      setActiveTab('schedule');
      return;
    }
    setActiveTab(tab);
  };

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    loadSchedule(dateStr);
  };

  const handleAuthenticated = (newSession: AuthSession) => {
    setSession(newSession);
    if (newSession.role === 'resident' && activeTab === 'admin') {
      setActiveTab('schedule');
    }
    setToast({
      message:
        newSession.role === 'admin'
          ? 'Yönetici oturumu açıldı.'
          : `Daire ${newSession.apartmentNo} olarak giriş yapıldı.`,
      tone: 'success',
    });
    if (newSession.role === 'resident') {
      loadSchedule();
    }
  };

  const handleLogout = () => {
    setSession(null);
    setToast({ message: 'Oturum kapatıldı.', tone: 'success' });
    loadSchedule();
  };

  const handleSlotToCancel = (slot: ScheduleSlot) => {
    if (!slot.reservation) return;
    setCancelTarget({
      id: slot.reservation.id,
      dateStr: schedule?.dateStr || selectedDate,
      hour: slot.hour,
      startMs: slot.startMs,
    });
  };

  const handleReservationToCancel = (res: ReservationItem) => {
    setCancelTarget({
      id: res.id,
      dateStr: res.dateStr,
      hour: res.hour,
      startMs: res.startMs,
    });
  };

  // Detect live conflict if another apartment reserved the slot while BookingModal is open
  const liveMatchingSlot =
    bookingSlot && schedule
      ? schedule.slots.find((s) => s.hour === bookingSlot.hour)
      : null;
  const reservedByOtherInModal =
    liveMatchingSlot?.reservation && !liveMatchingSlot.reservation.isOwn
      ? liveMatchingSlot.reservation.apartmentNo
      : null;

  const effectiveTab: ActiveTab =
    session?.role === 'resident' && activeTab === 'admin' ? 'schedule' : activeTab;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100/70 text-slate-900">
      <Header
        activeTab={effectiveTab}
        onSelectTab={handleSelectTab}
        session={session}
        onOpenResidentLogin={() => {
          loadAuthStatus();
          setAuthModalOpen(true);
        }}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-7 pb-24 md:pb-8">
        {toast && (
          <div
            role="status"
            className={`mb-4 sm:mb-6 px-4 py-3 rounded-2xl border flex items-center justify-between gap-3 text-xs font-medium ${
              toast.tone === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  toast.tone === 'warning' ? 'bg-amber-100' : 'bg-emerald-100'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              </div>
              <span>{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Bildirimi kapat"
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-black/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {effectiveTab === 'schedule' && (
          <CourtScheduleView
            schedule={schedule}
            loading={scheduleLoading}
            error={scheduleError}
            selectedDate={selectedDate || schedule?.todayStr || getTodayIstanbulDateStr()}
            onSelectDate={handleSelectDate}
            session={session}
            onOpenResidentLogin={() => {
              loadAuthStatus();
              setAuthModalOpen(true);
            }}
            onSelectSlotToBook={(slot) => setBookingSlot(slot)}
            onSelectSlotToCancel={handleSlotToCancel}
          />
        )}

        {effectiveTab === 'portal' && (
          <ResidentPortalView
            session={session}
            onOpenResidentLogin={() => {
              loadAuthStatus();
              setAuthModalOpen(true);
            }}
            onGoToSchedule={() => handleSelectTab('schedule')}
            onRequestCancel={handleReservationToCancel}
            refreshTrigger={portalRefreshTick}
          />
        )}

        {effectiveTab === 'rules' && <RulesView />}

        {effectiveTab === 'admin' && (
          <AdminConsoleView
            session={session}
            adminSetupNeeded={authStatus?.adminSetupNeeded ?? false}
            onAuthenticated={handleAuthenticated}
            onRefreshAuthStatus={loadAuthStatus}
            refreshTrigger={portalRefreshTick}
          />
        )}
      </main>

      <footer className="hidden md:block border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>Soyak Siesta Tenis Kortu · Kullanım Saatleri 07:00 - 23:00</span>
          <button
            type="button"
            onClick={() => handleSelectTab('rules')}
            className="text-slate-600 hover:text-slate-900 underline cursor-pointer"
          >
            Kullanım Esaslarını Görüntüle
          </button>
        </div>
      </footer>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        authStatus={authStatus}
        onAuthenticated={handleAuthenticated}
        onGoToAdmin={() => setActiveTab('admin')}
      />

      {session?.role === 'resident' && session.apartmentNo && (
        <BookingModal
          slot={bookingSlot}
          dateStr={schedule?.dateStr || selectedDate}
          apartmentNo={session.apartmentNo}
          token={session.token}
          reservedByOtherApt={reservedByOtherInModal}
          onClose={() => setBookingSlot(null)}
          onBooked={(notice) => {
            setBookingSlot(null);
            setToast({ message: notice, tone: 'success' });
            loadSchedule();
            setPortalRefreshTick((n) => n + 1);
          }}
        />
      )}

      {session?.role === 'resident' && (
        <CancelModal
          target={cancelTarget}
          nowMs={schedule?.nowMs ?? Date.now()}
          lateCancelsLast15d={schedule?.residentSummary?.lateCancelsLast15d ?? 0}
          token={session.token}
          onClose={() => setCancelTarget(null)}
          onCancelled={(message, isLate) => {
            setCancelTarget(null);
            setToast({ message, tone: isLate ? 'warning' : 'success' });
            loadSchedule();
            setPortalRefreshTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
