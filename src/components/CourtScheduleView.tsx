import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  Clock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Download,
  Droplets,
  Lock,
  MapPin,
  ShieldAlert,
  Sun,
  UserCheck,
  Wind,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  addDaysToDateStr,
  formatHourRange,
  formatIstanbulDateTime,
  formatTurkishDateFull,
  formatTurkishDateShort,
  getTodayIstanbulDateStr,
  pad2,
} from '../lib/api';
import courtVenueImg from '../assets/images/tennis_court_venue_1795610561470.jpg';
import { downloadIcsCalendarEvent } from '../lib/calendar';
import type {
  AuthSession,
  ScheduleResponse,
  ScheduleSlot,
  WeatherHourlySlot,
  WeatherResponse,
} from '../shared/types';

interface CourtScheduleViewProps {
  schedule: ScheduleResponse | null;
  loading: boolean;
  error: string | null;
  weather: WeatherResponse | null;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  session: AuthSession | null;
  onOpenResidentLogin: () => void;
  onSelectSlotToBook: (slot: ScheduleSlot) => void;
  onSelectSlotToCancel: (slot: ScheduleSlot) => void;
}

const COURT_IMAGE_PATH = courtVenueImg;

function WeatherGlyph({ code, className }: { code: number; className?: string }) {
  if (code === 0) return <Sun className={className} aria-hidden="true" />;
  if (code === 1 || code === 2) return <CloudSun className={className} aria-hidden="true" />;
  if (code === 45 || code === 48) return <CloudFog className={className} aria-hidden="true" />;
  if ([51, 53, 55, 56, 57].includes(code))
    return <CloudDrizzle className={className} aria-hidden="true" />;
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return <CloudRain className={className} aria-hidden="true" />;
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return <CloudSnow className={className} aria-hidden="true" />;
  if ([95, 96, 99].includes(code))
    return <CloudLightning className={className} aria-hidden="true" />;
  return <Cloud className={className} aria-hidden="true" />;
}

export function CourtScheduleView({
  schedule,
  loading,
  error,
  weather,
  selectedDate,
  onSelectDate,
  session,
  onOpenResidentLogin,
  onSelectSlotToBook,
  onSelectSlotToCancel,
}: CourtScheduleViewProps) {
  const [imgError, setImgError] = useState(false);
  const [weatherDay, setWeatherDay] = useState<'today' | 'tomorrow'>('today');

  const todayStr = schedule?.todayStr || selectedDate || getTodayIstanbulDateStr();
  const nowHour = schedule?.nowHour ?? new Date().getHours();

  const dateTabs = Array.from({ length: 7 }, (_, i) => {
    const dStr = addDaysToDateStr(todayStr, i);
    const { weekday, dayMonth } = formatTurkishDateShort(dStr);
    return {
      dateStr: dStr,
      topLabel: i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : weekday,
      bottomLabel: dayMonth,
    };
  });

  const tomorrowStr = addDaysToDateStr(todayStr, 1);

  const hourlyWeatherMap = useMemo(() => {
    const map = new Map<string, WeatherHourlySlot>();
    for (const h of weather?.hourly ?? []) {
      map.set(`${h.dateStr}-${h.hour}`, h);
    }
    return map;
  }, [weather]);

  const todayDailyWeather = useMemo(() => {
    return (weather?.daily ?? []).find((d) => d.dateStr === todayStr) ?? null;
  }, [weather, todayStr]);

  const tomorrowDailyWeather = useMemo(() => {
    return (weather?.daily ?? []).find((d) => d.dateStr === tomorrowStr) ?? null;
  }, [weather, tomorrowStr]);

  const todayHourlyCourt = useMemo(() => {
    return (weather?.hourly ?? []).filter(
      (h) => h.dateStr === todayStr && h.hour >= 7 && h.hour <= 22
    );
  }, [weather, todayStr]);

  const tomorrowHourlyCourt = useMemo(() => {
    return (weather?.hourly ?? []).filter(
      (h) => h.dateStr === tomorrowStr && h.hour >= 7 && h.hour <= 22
    );
  }, [weather, tomorrowStr]);

  const residentSummary = schedule?.residentSummary ?? null;
  const courtStatus = schedule?.courtStatus;

  const activeWeatherSummary =
    weatherDay === 'today' ? todayDailyWeather : tomorrowDailyWeather;
  const activeHourlyCourt =
    weatherDay === 'today' ? todayHourlyCourt : tomorrowHourlyCourt;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact 2-Row İzmir Karşıyaka Weather Bar (Bugün / Yarın Switcher) */}
      {weather?.available && (
        <section
          aria-label="İzmir Karşıyaka Hava Durumu"
          className="bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 space-y-2"
        >
          {/* Row 1: Bugün/Yarın Toggle + Inline Daily Summary on the Same Line */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <div
                role="tablist"
                aria-label="Hava durumu günü"
                className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-xl shrink-0"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={weatherDay === 'today'}
                  onClick={() => setWeatherDay('today')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    weatherDay === 'today'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bugün
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={weatherDay === 'tomorrow'}
                  onClick={() => setWeatherDay('tomorrow')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    weatherDay === 'tomorrow'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Yarın
                </button>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <WeatherGlyph
                  code={
                    weatherDay === 'today' && weather.current
                      ? weather.current.weatherCode
                      : activeWeatherSummary?.weatherCode ?? 0
                  }
                  className="w-5 h-5 text-sky-700 shrink-0"
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs sm:text-sm">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span>{weather.locationLabel}</span>
                  </span>
                  <span className="font-mono text-sm sm:text-base font-bold text-slate-900 tabular-nums">
                    {weatherDay === 'today' && weather.current
                      ? `${weather.current.tempC}°C`
                      : activeWeatherSummary
                      ? `${activeWeatherSummary.tempMinC}° / ${activeWeatherSummary.tempMaxC}°C`
                      : '—'}
                  </span>
                  <span className="text-xs font-semibold text-slate-700">
                    {weatherDay === 'today' && weather.current
                      ? weather.current.conditionLabel
                      : activeWeatherSummary?.conditionLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 font-medium tabular-nums">
              {activeWeatherSummary && (
                <span>
                  <strong className="font-mono text-slate-900">
                    {activeWeatherSummary.tempMinC}° / {activeWeatherSummary.tempMaxC}°
                  </strong>
                </span>
              )}
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="inline-flex items-center gap-1">
                <Wind className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span className="font-mono font-semibold text-slate-900">
                  {weatherDay === 'today' && weather.current
                    ? weather.current.windKmh
                    : activeWeatherSummary?.windMaxKmh ?? 0}{' '}
                  km/sa
                </span>
              </span>
              {activeWeatherSummary && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Droplets className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                    <span className="font-mono font-semibold text-slate-900">
                      %{activeWeatherSummary.precipProbMax}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Row 2: Readable Single-Row Hourly Strip (07:00 - 23:00 for Selected Weather Day) */}
          {activeHourlyCourt.length > 0 && (
            <div className="flex items-stretch gap-2 overflow-x-auto pt-2 border-t border-slate-100 pb-0.5">
              {activeHourlyCourt.map((h) => {
                const isCurrentHour = weatherDay === 'today' && h.hour === nowHour;
                const isPastHour = weatherDay === 'today' && h.hour < nowHour;
                const rainy = h.precipProb >= 35;
                return (
                  <div
                    key={`${weatherDay}-${h.hour}`}
                    className={`min-w-[68px] sm:min-w-[74px] px-2.5 py-2 rounded-xl border text-center shrink-0 flex flex-col items-center justify-center gap-1 ${
                      isCurrentHour
                        ? 'bg-emerald-50 border-emerald-600 shadow-[0_2px_0_0_#10b981] text-slate-900'
                        : rainy
                        ? 'bg-sky-50/90 border-sky-300 text-slate-900'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
                    } ${isPastHour ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`font-mono text-xs font-semibold leading-none tabular-nums ${
                        isCurrentHour ? 'text-emerald-800 font-bold' : 'text-slate-600'
                      }`}
                    >
                      {pad2(h.hour)}:00
                    </span>
                    <div className="flex items-center gap-1 leading-none">
                      <WeatherGlyph
                        code={h.weatherCode}
                        className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${
                          rainy ? 'text-sky-700' : 'text-amber-600'
                        }`}
                      />
                      <span className="font-mono text-sm sm:text-[15px] font-bold text-slate-900 tabular-nums">
                        {h.tempC}°
                      </span>
                    </div>
                    <span
                      className={`font-mono text-[11px] leading-none tabular-nums ${
                        rainy ? 'text-sky-800 font-bold' : 'text-slate-600 font-medium'
                      }`}
                    >
                      %{h.precipProb}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Top Android-Style Live Court Status + Venue Tile */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-stretch">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 flex flex-col justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                courtStatus?.closure
                  ? 'bg-slate-800 text-white border-slate-800'
                  : courtStatus?.walkInAvailable
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : courtStatus?.reservedBy
                  ? 'bg-rose-700 text-white border-rose-700'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {courtStatus?.closure ? (
                courtStatus.closure.reasonType === 'maintenance' ? (
                  <Wrench className="w-6 h-6" aria-hidden="true" />
                ) : (
                  <Lock className="w-6 h-6" aria-hidden="true" />
                )
              ) : courtStatus?.walkInAvailable ? (
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
                    ? courtStatus.closure
                      ? courtStatus.closure.reasonType === 'maintenance'
                        ? 'Kort bakım nedeniyle kapalı'
                        : courtStatus.closure.reasonType === 'event'
                        ? 'Kort etkinlik nedeniyle kapalı'
                        : 'Kort şu an kapalı'
                      : courtStatus.walkInAvailable
                      ? 'Kort şu an müsait'
                      : `Kort şu an Daire ${courtStatus.reservedBy} kullanımında`
                    : 'Kort kullanım saatleri dışında'
                  : 'Kort durumu yükleniyor'}
              </h1>

              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {courtStatus?.closure
                  ? `${courtStatus.currentHourLabel} dilimi · ${courtStatus.closure.reasonText}`
                  : courtStatus?.walkInAvailable
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
            <p className="pt-2.5 border-t border-slate-100 text-xs text-slate-500">
              Saat ayırtmak için üstten giriş yapın veya aşağıdaki müsait bir saat kutusuna dokunun.
            </p>
          )}
        </div>

        {/* Venue Photo Card */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-200 rounded-2xl overflow-hidden h-36 sm:h-44 lg:h-auto lg:min-h-[172px] relative">
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
              18:00 - 21:00 · Üst üste 2 gün kapalı (15:00 sonrası boşsa açık)
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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-medium text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-white border border-slate-300 inline-block" />
              Müsait
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-cyan-100 border border-cyan-400 inline-block" />
              Yoğun Saat (18:00 - 21:00)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" />
              Rezerveli (Dolu)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-600 inline-block" />
              Sizin Kaydınız
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-200 border border-slate-400 inline-block" />
              Bakım / Etkinlik (Kapalı)
            </span>
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
                className="h-36 bg-white border border-slate-200 rounded-2xl p-4 animate-pulse flex flex-col justify-between"
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
              const isClosed = Boolean(slot.closure) && !slot.isPast;
              const canBook =
                !isClosed &&
                session?.role === 'resident' &&
                !slot.reservation &&
                !slot.isPast &&
                (slot.eligibility?.bookable ?? false);
              const canResidentClickGuest =
                !isClosed && !session && !slot.reservation && !slot.isPast;
              const canCancelOwn = isOwn && slot.startMs > (schedule?.nowMs ?? Date.now());
              const isBlocked =
                !isClosed &&
                session?.role === 'resident' &&
                !slot.reservation &&
                !slot.isPast &&
                !canBook;
              const isAdminOpenView =
                !isClosed &&
                session?.role === 'admin' &&
                !slot.reservation &&
                !slot.isPast;

              const isInteractive = canBook || canResidentClickGuest || canCancelOwn;
              const slotWeather = !slot.isPast
                ? hourlyWeatherMap.get(`${selectedDate}-${slot.hour}`)
                : undefined;

              const handleTileClick = () => {
                if (canBook) {
                  onSelectSlotToBook(slot);
                } else if (canResidentClickGuest) {
                  onOpenResidentLogin();
                } else if (canCancelOwn) {
                  onSelectSlotToCancel(slot);
                }
              };

              const isOpenPrime =
                !isClosed &&
                slot.primeTime &&
                !slot.isPast &&
                !slot.reservation &&
                (canBook || canResidentClickGuest || isAdminOpenView);

              const cardClasses = isOwn
                ? 'bg-emerald-50 border-2 border-emerald-600 shadow-[0_3px_0_0_#059669] hover:shadow-[0_4px_0_0_#047857] active:translate-y-[1px] active:shadow-[0_1px_0_0_#047857] text-slate-900'
                : isClosed
                ? 'bg-slate-200/80 border-[1.5px] border-slate-400 shadow-[0_3px_0_0_#94a3b8] text-slate-900'
                : slot.reservation
                ? 'bg-rose-50/95 border-[1.5px] border-rose-300 shadow-[0_3px_0_0_#fda4af] text-slate-900'
                : slot.isPast
                ? 'bg-slate-100/85 border border-slate-300/80 shadow-[0_2px_0_0_#cbd5e1] text-slate-400'
                : isOpenPrime
                ? `bg-cyan-50/95 border-[1.5px] border-cyan-400 shadow-[0_3px_0_0_#22d3ee] text-slate-900 ${
                    isInteractive
                      ? 'hover:border-cyan-600 hover:shadow-[0_4px_0_0_#0891b2] active:translate-y-[1px] active:shadow-[0_1px_0_0_#0891b2]'
                      : ''
                  }`
                : canBook || canResidentClickGuest || isAdminOpenView
                ? `bg-white border-[1.5px] border-slate-300 shadow-[0_3px_0_0_#cbd5e1] text-slate-900 ${
                    isInteractive
                      ? 'hover:border-emerald-600 hover:shadow-[0_4px_0_0_#10b981] active:translate-y-[1px] active:shadow-[0_1px_0_0_#10b981]'
                      : ''
                  }`
                : 'bg-amber-50/75 border-[1.5px] border-amber-300 shadow-[0_3px_0_0_#fcd34d] text-slate-700';

              const iconBoxClasses = isOwn
                ? 'bg-emerald-700 text-white'
                : isClosed
                ? 'bg-slate-700 text-white'
                : slot.reservation
                ? 'bg-rose-700 text-white'
                : slot.isPast
                ? 'bg-slate-200 text-slate-500'
                : isOpenPrime
                ? 'bg-cyan-100 text-cyan-800'
                : canBook || canResidentClickGuest || isAdminOpenView
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
                  className={`rounded-2xl p-3.5 sm:p-4 min-h-[146px] flex flex-col justify-between gap-2.5 transition-all ${cardClasses} ${
                    isInteractive
                      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700'
                      : ''
                  }`}
                >
                  {/* Top Row: Boxy Status Icon + Larger Weather / Current marker */}
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBoxClasses}`}
                    >
                      {isOwn ? (
                        <CalendarCheck className="w-5 h-5" aria-hidden="true" />
                      ) : isClosed ? (
                        slot.closure?.reasonType === 'maintenance' ? (
                          <Wrench className="w-5 h-5" aria-hidden="true" />
                        ) : (
                          <Lock className="w-5 h-5" aria-hidden="true" />
                        )
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

                    <div className="text-right space-y-0.5 shrink-0">
                      {slotWeather && (
                        <span className="inline-flex items-center justify-end gap-1 font-mono text-[13px] sm:text-sm font-bold text-slate-800 tabular-nums whitespace-nowrap">
                          <WeatherGlyph
                            code={slotWeather.weatherCode}
                            className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${
                              slotWeather.precipProb >= 35 ? 'text-sky-700' : 'text-amber-600'
                            }`}
                          />
                          <span>{slotWeather.tempC}°</span>
                          {slotWeather.precipProb >= 30 && (
                            <span className="text-[11px] sm:text-xs font-semibold text-sky-800">
                              %{slotWeather.precipProb}
                            </span>
                          )}
                        </span>
                      )}
                      {slot.isCurrent && (
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                          Şu An
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle: Larger Clear Time & Status */}
                  <div className="space-y-1">
                    <p
                      className={`font-mono text-base sm:text-lg font-bold tracking-tight tabular-nums ${
                        slot.isPast
                          ? 'text-slate-400'
                          : isOwn
                          ? 'text-emerald-950'
                          : slot.reservation
                          ? 'text-rose-950'
                          : 'text-slate-900'
                      }`}
                    >
                      {formatHourRange(slot.hour)}
                    </p>
                    {slot.primeTime && !slot.isPast && !isClosed && (
                      <p
                        className={`text-[11px] font-semibold ${
                          isOwn
                            ? 'text-emerald-800'
                            : slot.reservation
                            ? 'text-rose-800'
                            : isBlocked
                            ? 'text-amber-800'
                            : 'text-cyan-800'
                        }`}
                      >
                        Yoğun Kullanım Saati
                      </p>
                    )}

                    {isClosed ? (
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-slate-800">
                          {slot.closure!.reasonType === 'maintenance'
                            ? 'Bakım · Kapalı'
                            : slot.closure!.reasonType === 'event'
                            ? 'Etkinlik · Kapalı'
                            : 'Yönetim · Kapalı'}
                        </p>
                        <p
                          className="text-xs text-slate-700 leading-snug line-clamp-2"
                          title={slot.closure!.reasonText}
                        >
                          {slot.closure!.reasonText}
                        </p>
                      </div>
                    ) : slot.reservation ? (
                      <div className="space-y-0.5">
                        <p
                          className={`text-xs sm:text-sm font-bold truncate ${
                            isOwn ? 'text-emerald-900' : 'text-rose-900'
                          }`}
                        >
                          {isOwn ? 'Sizin Kaydınız' : `Daire ${slot.reservation.apartmentNo}`}
                        </p>
                        <p
                          className={`text-xs truncate ${
                            isOwn ? 'text-emerald-800/80' : 'text-rose-800/85'
                          }`}
                        >
                          {slot.reservation.playType === 'solo_training'
                            ? 'Bireysel Antrenman'
                            : 'Eşli / Grup Maçı'}
                        </p>
                      </div>
                    ) : slot.isPast ? (
                      <p className="text-xs text-slate-400">Süresi Doldu</p>
                    ) : isBlocked ? (
                      <p
                        className="text-xs text-amber-900 leading-snug line-clamp-2"
                        title={slot.eligibility?.reason || 'Kapalı'}
                      >
                        {slot.eligibility?.reason || 'Rezervasyon kapalı'}
                      </p>
                    ) : (
                      <p className="text-xs font-semibold text-emerald-800">
                        Müsait
                        {slot.eligibility?.primeOverrideUsed ? ' · 15:00 Açık' : ''}
                      </p>
                    )}
                  </div>

                  {/* Bottom: Clear Tactile Action Label */}
                  <div
                    className={`pt-1.5 border-t flex items-center justify-between gap-2 text-xs font-semibold ${
                      isClosed
                        ? 'border-slate-300'
                        : slot.reservation && !isOwn
                        ? 'border-rose-200/80'
                        : isOwn
                        ? 'border-emerald-200'
                        : isOpenPrime
                        ? 'border-cyan-200'
                        : 'border-black/5'
                    }`}
                  >
                    {isClosed ? (
                      <span className="text-slate-700 font-bold">
                        {slot.closure!.reasonType === 'maintenance'
                          ? 'Bakım · Rezervasyona Kapalı'
                          : slot.closure!.reasonType === 'event'
                          ? 'Etkinlik · Rezervasyona Kapalı'
                          : 'Yönetim · Rezervasyona Kapalı'}
                      </span>
                    ) : isOwn ? (
                      <>
                        {canCancelOwn ? (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>İptal Et</span>
                          </span>
                        ) : (
                          <span className="text-emerald-800">Kullanımda</span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadIcsCalendarEvent({
                              id: slot.reservation!.id,
                              dateStr: selectedDate,
                              hour: slot.hour,
                              startMs: slot.startMs,
                              endMs: slot.endMs,
                              apartmentNo: slot.reservation!.apartmentNo,
                              playType: slot.reservation!.playType,
                            });
                          }}
                          title="Ajandaya ekle (.ics)"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg cursor-pointer"
                        >
                          <Download className="w-3 h-3" aria-hidden="true" />
                          <span>Ajanda</span>
                        </button>
                      </>
                    ) : slot.reservation ? (
                      <span className="text-rose-700 font-bold">Rezerveli · Dolu</span>
                    ) : slot.isPast ? (
                      <span className="text-slate-400">Geçmiş</span>
                    ) : canBook ? (
                      <span className="text-emerald-700">Rezerve Et →</span>
                    ) : canResidentClickGuest ? (
                      <span className="text-slate-700">Giriş ile Ayırt →</span>
                    ) : isAdminOpenView ? (
                      <span className="text-emerald-800">Boş · Rezervasyona Açık</span>
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
