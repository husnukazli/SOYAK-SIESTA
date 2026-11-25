import { useState } from 'react';
import { AlertCircle, Calendar, Clock, Lock, ShieldAlert, UserCheck } from 'lucide-react';
import {
  addDaysToDateStr,
  formatHourRange,
  formatIstanbulDateTime,
  formatTurkishDateFull,
  formatTurkishDateShort,
  getTodayIstanbulDateStr,
} from '../lib/api';
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

const COURT_IMAGE_PATH = '/src/assets/images/tennis_court_venue_1795610561470.jpg';

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
    <div className="space-y-8">
      {/* Hero Split: Live Court Status & Venue Frame (items-stretch for equal column height) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Soyak Siesta Tenis Kortu</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{schedule?.nowIstanbulLabel || 'TSİ Saat Yükleniyor'}</span>
              <span aria-hidden="true">·</span>
              <span>Çalışma Saatleri 07:00 - 23:00</span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
              {courtStatus
                ? courtStatus.isOperational
                  ? courtStatus.walkInAvailable
                    ? 'Kort şu an müsait, rezervasyonsuz kullanıma açık'
                    : `Kort şu an Daire ${courtStatus.reservedBy} kullanımında`
                  : 'Kort şu an günlük kullanım saatleri dışındadır'
                : 'Günlük Kort Durumu Yükleniyor'}
            </h1>

            <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
              {courtStatus?.walkInAvailable
                ? 'Müsait saatlerde rezervasyon yapmadan kortu kullanabilirsiniz; ancak bu saat dilimi çevrim içi rezerve edildiği anda kullanım önceliği rezerve eden daireye aittir.'
                : courtStatus?.reservedBy
                ? `Aktif saat dilimi (${courtStatus.currentHourLabel}) için ${
                    courtStatus.playType === 'solo_training'
                      ? 'bireysel antrenman'
                      : 'eşli / grup maçı'
                  } rezervasyonu bulunmaktadır.`
                : 'Çevrim içi rezervasyonlar 07:00 - 23:00 saatleri arası 1 saatlik dilimler halinde, en fazla 7 gün ileriye kadar yapılabilir.'}
            </p>
          </div>

          {/* Resident Status Strip or Sign-in CTA */}
          {session?.role === 'resident' && residentSummary ? (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              {residentSummary.banUntilMs ? (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-900">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      Daire {residentSummary.apartmentNo} Rezervasyon Kısıtlaması Aktif
                    </p>
                    <p>
                      {residentSummary.banReason} · Bitiş:{' '}
                      <span className="font-mono">
                        {formatIstanbulDateTime(residentSummary.banUntilMs)}
                      </span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                    <span className="font-semibold text-slate-900">
                      Daire {residentSummary.apartmentNo}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Aktif Rezervasyon:{' '}
                      <strong className="font-mono text-slate-900">
                        {residentSummary.activeReservation
                          ? `${residentSummary.activeReservation.dateStr} ${formatHourRange(
                              residentSummary.activeReservation.hour
                            )}`
                          : 'Yok'}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      15 Günlük Geç İptal:{' '}
                      <strong
                        className={`font-mono ${
                          residentSummary.lateCancelsLast15d > 0
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {residentSummary.lateCancelsLast15d} / 2
                      </strong>
                    </span>
                  </div>
                  {residentSummary.activeReservation && (
                    <span className="text-xs text-slate-500">
                      Mevcut saat bitmeden yeni kayıt açılamaz
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : session?.role === 'admin' ? (
            <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>Yönetici oturumu aktif · Rezervasyon yapmak için daire girişi gerekir.</span>
            </div>
          ) : (
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-slate-600">
                Rezervasyon oluşturmak veya iptal etmek için daire şifrenizle giriş yapın.
              </p>
              <button
                type="button"
                onClick={onOpenResidentLogin}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Daire Girişi Yap
              </button>
            </div>
          )}
        </div>

        {/* Venue Photo Column */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-200 rounded-xl overflow-hidden min-h-[220px] lg:min-h-0 relative">
          {!imgError ? (
            <img
              src={COURT_IMAGE_PATH}
              alt="Site açık tenis kortu ve çevresi"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full lg:h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 flex flex-col items-center justify-center p-6 text-center text-white">
              <Calendar className="w-8 h-8 text-emerald-300 mb-2" aria-hidden="true" />
              <p className="font-display text-sm font-semibold">Site Tenis Kortu</p>
              <p className="text-xs text-emerald-100/80 mt-1">07:00 - 23:00 Günlük Program</p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent p-5 text-white">
            <p className="text-xs text-slate-200">Yoğun Saat Aralığı</p>
            <p className="font-mono text-sm font-semibold mt-0.5">
              18:00 - 21:00 · Üst üste 2 gün kısıtlı (16:00 sonrası boşsa açık)
            </p>
          </div>
        </div>
      </section>

      {/* Date Selector Strip */}
      <section aria-label="Gün seçimi" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              {formatTurkishDateFull(selectedDate)}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Her saat dilimi 60 dakikalıktır · Aynı gün en fazla 1 rezervasyon yapılabilir
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto">
            {dateTabs.map((tab) => {
              const active = tab.dateStr === selectedDate;
              return (
                <button
                  key={tab.dateStr}
                  type="button"
                  onClick={() => onSelectDate(tab.dateStr)}
                  className={`px-3 py-1.5 rounded-md text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="block text-[11px] font-semibold leading-tight">
                    {tab.topLabel}
                  </span>
                  <span className="block font-mono text-[11px] text-slate-500 leading-tight mt-0.5">
                    {tab.bottomLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Hourly Schedule Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
            <div className="col-span-4 sm:col-span-3">Saat Aralığı</div>
            <div className="col-span-4 sm:col-span-5">Durum ve Kullanım Türü</div>
            <div className="col-span-4 text-right">İşlem</div>
          </div>

          {loading && !schedule ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="px-5 py-4 flex items-center justify-between animate-pulse">
                  <div className="h-4 w-28 bg-slate-200 rounded" />
                  <div className="h-4 w-40 bg-slate-100 rounded" />
                  <div className="h-8 w-24 bg-slate-200 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
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

                return (
                  <div
                    key={slot.hour}
                    className={`grid grid-cols-12 items-center px-5 py-3.5 gap-3 transition-colors ${
                      slot.isCurrent
                        ? 'bg-emerald-50/40'
                        : slot.isPast
                        ? 'bg-slate-50/60 text-slate-400'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Column 1: Hour & Prime Marker */}
                    <div className="col-span-4 sm:col-span-3 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-sm font-semibold ${
                            slot.isPast ? 'text-slate-400' : 'text-slate-900'
                          }`}
                        >
                          {slot.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        {slot.isCurrent && (
                          <span className="font-semibold text-emerald-700">Şu An ·</span>
                        )}
                        <span>
                          {slot.primeTime ? 'Yoğun Saat' : 'Bireysel Antrenman Açık'}
                        </span>
                      </div>
                    </div>

                    {/* Column 2: Status & Rule Explanation */}
                    <div className="col-span-4 sm:col-span-5 space-y-0.5">
                      {slot.reservation ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-900">
                            <UserCheck
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isOwn ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                              aria-hidden="true"
                            />
                            <span>
                              {isOwn
                                ? 'Sizin Rezervasyonunuz'
                                : `Daire ${slot.reservation.apartmentNo}`}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {slot.reservation.playType === 'solo_training'
                              ? 'Bireysel Antrenman'
                              : 'Eşli / Grup Maçı'}
                          </p>
                        </div>
                      ) : slot.isPast ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Süresi Doldu</span>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <p className="text-xs sm:text-sm font-medium text-emerald-800">
                            Müsait
                            {slot.eligibility?.sixteenHourOverrideUsed
                              ? ' · 16:00 Sonrası Açık'
                              : ''}
                          </p>
                          {session?.role === 'resident' &&
                          slot.eligibility &&
                          !slot.eligibility.bookable &&
                          slot.eligibility.reason ? (
                            <p className="text-[11px] text-amber-800 leading-snug">
                              {slot.eligibility.reason}
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-500">
                              {slot.isCurrent
                                ? 'Rezervasyonsuz kullanımda öncelik rezerve edene geçer'
                                : slot.primeTime
                                ? 'Yalnızca maç / daire sakini katılımı'
                                : 'Maç veya bireysel antrenman'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Column 3: Action */}
                    <div className="col-span-4 flex justify-end">
                      {isOwn ? (
                        canCancelOwn ? (
                          <button
                            type="button"
                            onClick={() => onSelectSlotToCancel(slot)}
                            className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            İptal Et
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            Aktif Kullanım
                          </span>
                        )
                      ) : slot.reservation ? (
                        <span className="text-xs text-slate-400 whitespace-nowrap">Dolu</span>
                      ) : slot.isPast ? (
                        <span className="text-xs text-slate-400 whitespace-nowrap">—</span>
                      ) : canBook ? (
                        <button
                          type="button"
                          onClick={() => onSelectSlotToBook(slot)}
                          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Rezerve Et
                        </button>
                      ) : canResidentClickGuest ? (
                        <button
                          type="button"
                          onClick={onOpenResidentLogin}
                          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Giriş ile Ayırt
                        </button>
                      ) : (
                        <span
                          title={slot.eligibility?.reason || 'Rezervasyon yapılamaz'}
                          className="inline-flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap"
                        >
                          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Kapalı</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
