import { useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  Clock,
  Flame,
  Lock,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  addDaysToDateStr,
  formatHourRange,
  formatIstanbulDateTime,
  formatTurkishDateFull,
  formatTurkishDateShort,
  getTodayIstanbulDateStr,
} from '../lib/api';
import courtVenueImg from '../assets/images/tennis_court_venue_1795610561470.jpg';
import type { AuthSession, ScheduleResponse, ScheduleSlot } from '../shared/types';

interface CourtScheduleViewProps {
  schedule: ScheduleResponse | null;
  loading: boolean;
  error: string | null;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  session: AuthSession | null;
  onOpenResidentLogin: () => void;
  onSelectSlotToBook: (slot: ScheduleSlot) => void;
  onSelectSlotToCancel: (slot: ScheduleSlot) => void;
}

const COURT_IMAGE_PATH = courtVenueImg;

export function CourtScheduleView({
  schedule,
  loading,
  error,
  selectedDate,
  onSelectDate,
  session,
  onOpenResidentLogin,
  onSelectSlotToBook,
  onSelectSlotToCancel,
}: CourtScheduleViewProps) {
  const [imgError, setImgError] = useState(false);

  const todayStr = schedule?.todayStr || selectedDate || getTodayIstanbulDateStr();
  const dateTabs = Array.from({ length: 7 }, (_, i) => {
    const dStr = addDaysToDateStr(todayStr, i);
    const { weekday, dayMonth } = formatTurkishDateShort(dStr);
    return {
      dateStr: dStr,
      topLabel: i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : weekday,
      bottomLabel: dayMonth,
    };
  });

  const residentSummary = schedule?.residentSummary ?? null;
  const courtStatus = schedule?.courtStatus;

  return (
    <div className="space-y-5 sm:space-y-7">
      {/* Top Android-Style Live Court Status + Venue Tile */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-stretch">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 flex flex-col justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                courtStatus?.walkInAvailable
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : courtStatus?.reservedBy
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {courtStatus?.walkInAvailable ? (
                <CalendarCheck className="w-6 h-6" aria-hidden="true" />
              ) : courtStatus?.reservedBy ? (
                <UserCheck className="w-6 h-6" aria-hidden="true" />
              ) : (
                <Clock className="w-6 h-6" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-500">
                <span className="font-mono text-slate-700">
                  {schedule?.nowIstanbulLabel || 'Saat yükleniyor'}
                </span>
                <span aria-hidden="true">·</span>
                <span>07:00 - 23:00</span>
              </div>

              <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-slate-900 text-balance leading-snug">
                {courtStatus
                  ? courtStatus.isOperational
                    ? courtStatus.walkInAvailable
                      ? 'Kort şu an müsait'
                      : `Kort şu an Daire ${courtStatus.reservedBy} kullanımında`
                    : 'Kort kullanım saatleri dışında'
                  : 'Kort durumu yükleniyor'}
              </h1>

              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {courtStatus?.walkInAvailable
                  ? 'Rezervasyonsuz kullanıma açık; ancak online rezervasyon yapıldığında öncelik rezerve eden daireye geçer.'
                  : courtStatus?.reservedBy
                  ? `${courtStatus.currentHourLabel} dilimi · ${
                      courtStatus.playType === 'solo_training'
                        ? 'Bireysel Antrenman'
                        : 'Eşli / Grup Maçı'
                    }`
                  : 'Aşağıdaki kutulardan bir saat seçerek 7 gün ileriye kadar rezervasyon yapabilirsiniz.'}
              </p>
            </div>
          </div>

          {/* Boxy Quick Status Strip */}
          {session?.role === 'resident' && residentSummary ? (
            residentSummary.banUntilMs ? (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-xs text-red-900">
                <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-red-700" aria-hidden="true" />
                </div>
                <div className="space-y-0.5">
                  <p className="font-semibold">
                    Daire {residentSummary.apartmentNo} Rezervasyon Kısıtlı
                  </p>
                  <p>
                    {residentSummary.banReason} · Bitiş:{' '}
                    <span className="font-mono font-semibold">
                      {formatIstanbulDateTime(residentSummary.banUntilMs)}
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <span className="block text-[10px] font-medium text-slate-500">Daire</span>
                  <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 truncate block mt-0.5">
                    {residentSummary.apartmentNo}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <span className="block text-[10px] font-medium text-slate-500">Aktif Kayıt</span>
                  <span className="font-mono text-xs sm:text-sm font-bold text-emerald-800 truncate block mt-0.5">
                    {residentSummary.activeReservation
                      ? `${residentSummary.activeReservation.hour}:00`
                      : 'Yok'}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <span className="block text-[10px] font-medium text-slate-500">15G Geç İptal</span>
                  <span
                    className={`font-mono text-xs sm:text-sm font-bold block mt-0.5 ${
                      residentSummary.lateCancelsLast15d > 0
                        ? 'text-amber-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {residentSummary.lateCancelsLast15d} / 2
                  </span>
                </div>
              </div>
            )
          ) : session?.role === 'admin' ? (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
              Yönetici oturumu aktif · Daire adına rezervasyon için daire girişi gerekir.
            </div>
          ) : (
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                Saat ayırtmak için daire şifrenizle giriş yapın.
              </p>
              <button
                type="button"
                onClick={onOpenResidentLogin}
                className="min-h-[44px] px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Daire Girişi Yap
              </button>
            </div>
          )}
        </div>

        {/* Venue Photo Card (compact on mobile, balanced on desktop) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-200 rounded-2xl overflow-hidden h-36 sm:h-44 lg:h-auto lg:min-h-[190px] relative">
          {!imgError ? (
            <img
              src={COURT_IMAGE_PATH}
              alt="Soyak Siesta açık tenis kortu"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 flex flex-col items-center justify-center p-4 text-center text-white">
              <Calendar className="w-7 h-7 text-emerald-300 mb-1.5" aria-hidden="true" />
              <p className="font-display text-sm font-semibold">Soyak Siesta Kort</p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent p-3.5 sm:p-4 text-white">
            <p className="text-[11px] text-slate-200">Yoğun Saat Kuralı</p>
            <p className="font-mono text-xs sm:text-sm font-semibold mt-0.5">
              18:00 - 21:00 · Üst üste 2 gün kapalı (16:00 sonrası boşsa açık)
            </p>
          </div>
        </div>
      </section>

      {/* Date Selector Tiles */}
      <section aria-label="Gün seçimi" className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900">
              {formatTurkishDateFull(selectedDate)}
            </h2>
            <p className="text-xs text-slate-500">
              Bir saat kutusuna dokunarak rezervasyon veya iptal işlemini başlatın
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {dateTabs.map((tab) => {
            const active = tab.dateStr === selectedDate;
            return (
              <button
                key={tab.dateStr}
                type="button"
                onClick={() => onSelectDate(tab.dateStr)}
                className={`min-w-[82px] min-h-[56px] px-3 py-2 rounded-2xl border text-left transition-all whitespace-nowrap shrink-0 cursor-pointer flex flex-col justify-center ${
                  active
                    ? 'bg-emerald-700 border-emerald-700 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className="block text-xs font-bold leading-tight">{tab.topLabel}</span>
                <span
                  className={`block font-mono text-[11px] leading-tight mt-1 ${
                    active ? 'text-emerald-100' : 'text-slate-500'
                  }`}
                >
                  {tab.bottomLabel}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-800 flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Android-Style Boxy Hour Tiles Grid */}
        {loading && !schedule ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="h-32 bg-white border border-slate-200 rounded-2xl p-4 animate-pulse flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <div className="w-9 h-9 bg-slate-200 rounded-xl" />
                  <div className="h-4 w-14 bg-slate-100 rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-24 bg-slate-200 rounded" />
                  <div className="h-3 w-16 bg-slate-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(schedule?.slots ?? []).map((slot) => {
              const isOwn = slot.reservation?.isOwn ?? false;
              const canBook =
                session?.role === 'resident' &&
                !slot.reservation &&
                !slot.isPast &&
                (slot.eligibility?.bookable ?? false);
              const canResidentClickGuest =
                !session && !slot.reservation && !slot.isPast;
              const canCancelOwn = isOwn && slot.startMs > (schedule?.nowMs ?? Date.now());
              const isBlocked =
                session?.role === 'resident' &&
                !slot.reservation &&
                !slot.isPast &&
                !canBook;

              const isInteractive = canBook || canResidentClickGuest || canCancelOwn;

              const handleTileClick = () => {
                if (canBook) {
                  onSelectSlotToBook(slot);
                } else if (canResidentClickGuest) {
                  onOpenResidentLogin();
                } else if (canCancelOwn) {
                  onSelectSlotToCancel(slot);
                }
              };

              const cardClasses = isOwn
                ? 'bg-emerald-50 border-emerald-500 text-slate-900'
                : slot.reservation
                ? 'bg-white border-slate-200 text-slate-900'
                : slot.isPast
                ? 'bg-slate-100/80 border-slate-200 text-slate-400'
                : canBook || canResidentClickGuest
                ? 'bg-white border-slate-200 hover:border-emerald-600 active:scale-[0.98] text-slate-900'
                : 'bg-amber-50/50 border-amber-200 text-slate-700';

              const iconBoxClasses = isOwn
                ? 'bg-emerald-700 text-white'
                : slot.reservation
                ? 'bg-slate-900 text-white'
                : slot.isPast
                ? 'bg-slate-200 text-slate-500'
                : canBook || canResidentClickGuest
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800';

              return (
                <div
                  key={slot.hour}
                  role={isInteractive ? 'button' : undefined}
                  tabIndex={isInteractive ? 0 : undefined}
                  onClick={isInteractive ? handleTileClick : undefined}
                  onKeyDown={
                    isInteractive
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleTileClick();
                          }
                        }
                      : undefined
                  }
                  className={`rounded-2xl border p-3.5 sm:p-4 min-h-[132px] flex flex-col justify-between gap-3 transition-all ${cardClasses} ${
                    isInteractive ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700' : ''
                  }`}
                >
                  {/* Top Row: Boxy Status Icon + Prime/Current marker */}
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBoxClasses}`}
                    >
                      {isOwn ? (
                        <CalendarCheck className="w-5 h-5" aria-hidden="true" />
                      ) : slot.reservation ? (
                        <UserCheck className="w-5 h-5" aria-hidden="true" />
                      ) : slot.isPast ? (
                        <Clock className="w-5 h-5" aria-hidden="true" />
                      ) : isBlocked ? (
                        <Lock className="w-5 h-5" aria-hidden="true" />
                      ) : (
                        <CalendarPlus className="w-5 h-5" aria-hidden="true" />
                      )}
                    </div>

                    <div className="text-right">
                      {slot.isCurrent && (
                        <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          Şu An
                        </span>
                      )}
                      {slot.primeTime && !slot.isPast && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                          <Flame className="w-3 h-3" aria-hidden="true" />
                          <span>Yoğun</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle: Time & Status */}
                  <div className="space-y-1">
                    <p
                      className={`font-mono text-sm sm:text-base font-bold tracking-tight ${
                        slot.isPast ? 'text-slate-400' : 'text-slate-900'
                      }`}
                    >
                      {formatHourRange(slot.hour)}
                    </p>

                    {slot.reservation ? (
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {isOwn ? 'Sizin Kaydınız' : `Daire ${slot.reservation.apartmentNo}`}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {slot.reservation.playType === 'solo_training'
                            ? 'Bireysel Antrenman'
                            : 'Eşli / Grup Maçı'}
                        </p>
                      </div>
                    ) : slot.isPast ? (
                      <p className="text-xs text-slate-400">Süresi Doldu</p>
                    ) : isBlocked ? (
                      <p
                        className="text-[11px] text-amber-900 leading-snug line-clamp-2"
                        title={slot.eligibility?.reason || 'Kapalı'}
                      >
                        {slot.eligibility?.reason || 'Rezervasyon kapalı'}
                      </p>
                    ) : (
                      <p className="text-xs font-semibold text-emerald-800">
                        Müsait
                        {slot.eligibility?.sixteenHourOverrideUsed ? ' · 16:00 Açık' : ''}
                      </p>
                    )}
                  </div>

                  {/* Bottom: Clear Tactile Action Label */}
                  <div className="pt-1 border-t border-black/5 flex items-center justify-between text-[11px] font-semibold">
                    {isOwn ? (
                      canCancelOwn ? (
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>İptal Et</span>
                        </span>
                      ) : (
                        <span className="text-emerald-800">Kullanımda</span>
                      )
                    ) : slot.reservation ? (
                      <span className="text-slate-400">Dolu</span>
                    ) : slot.isPast ? (
                      <span className="text-slate-400">Geçmiş</span>
                    ) : canBook ? (
                      <span className="text-emerald-700">Rezerve Et →</span>
                    ) : canResidentClickGuest ? (
                      <span className="text-slate-700">Giriş ile Ayırt →</span>
                    ) : (
                      <span className="text-amber-800">Kısıtlı</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
