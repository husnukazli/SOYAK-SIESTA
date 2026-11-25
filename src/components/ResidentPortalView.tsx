import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  Clock,
  ShieldAlert,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import {
  api,
  ApiError,
  formatHourRange,
  formatIstanbulDateTime,
  formatRemainingDuration,
  formatTurkishDateFull,
} from '../lib/api';
import type { AuthSession, ResidentPortalResponse, ReservationItem } from '../shared/types';

interface ResidentPortalViewProps {
  session: AuthSession | null;
  onOpenResidentLogin: () => void;
  onGoToSchedule: () => void;
  onRequestCancel: (reservation: ReservationItem) => void;
  refreshTrigger: number;
}

export function ResidentPortalView({
  session,
  onOpenResidentLogin,
  onGoToSchedule,
  onRequestCancel,
  refreshTrigger,
}: ResidentPortalViewProps) {
  const [data, setData] = useState<ResidentPortalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.role !== 'resident') {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getResidentPortal(session.token)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Veriler alınamadı.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, refreshTrigger]);

  if (!session || session.role !== 'resident') {
    return (
      <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto">
          <CalendarCheck className="w-7 h-7" aria-hidden="true" />
        </div>
        <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900">
          Daire Rezervasyonları ve Ceza Durumu
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
          Aktif rezervasyonunuzu görüntülemek, iptal etmek veya 15 günlük geç iptal ve kullanım kayıtlarınızı incelemek için daire şifrenizle giriş yapın.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onOpenResidentLogin}
            className="min-h-[48px] w-full sm:w-auto px-6 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer"
          >
            Daire Girişi Yap
          </button>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-2xl" />
          ))}
        </div>
        <div className="h-44 bg-white border border-slate-200 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { apartment, reservations, penalties, nowMs } = data;
  const activeRes = apartment.activeReservation;
  const canCancelActive = activeRes ? activeRes.startMs > nowMs : false;
  const hoursUntilStart = activeRes ? (activeRes.startMs - nowMs) / (60 * 60 * 1000) : 0;
  const isLateWindow = activeRes ? hoursUntilStart < 4 : false;

  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
            {apartment.residentLabel} · Kayıtlarım
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Son 15 günlük geç iptal ve daire sakini denetim siciliniz
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSchedule}
          className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          Kort Programına Dön
        </button>
      </div>

      {/* Ban Banner if restricted */}
      {apartment.banUntilMs && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-xs sm:text-sm text-red-900">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-red-700" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="font-bold">Rezervasyon Hakkı Geçici Olarak Kısıtlıdır</p>
            <p className="text-xs leading-relaxed">
              {apartment.banReason} · Bitiş:{' '}
              <strong className="font-mono">{formatIstanbulDateTime(apartment.banUntilMs)}</strong>
            </p>
          </div>
        </div>
      )}

      {/* 2x2 Android Boxy KPI Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              apartment.banUntilMs ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {apartment.banUntilMs ? (
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            )}
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500">Hesap Durumu</span>
            <p
              className={`font-display text-base sm:text-lg font-bold mt-0.5 ${
                apartment.banUntilMs ? 'text-red-700' : 'text-emerald-800'
              }`}
            >
              {apartment.banUntilMs ? 'Kısıtlı' : 'Aktif / Uygun'}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <CalendarCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500">Aktif Kayıt</span>
            <p className="font-mono text-sm sm:text-base font-bold text-slate-900 mt-0.5 truncate">
              {activeRes ? formatHourRange(activeRes.hour) : 'Yok'}
            </p>
            {activeRes && (
              <p className="font-mono text-[10px] text-slate-500 mt-0.5">{activeRes.dateStr}</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              apartment.lateCancelsLast15d > 0
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Clock className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500">15G Geç İptal</span>
            <p
              className={`font-mono text-base sm:text-lg font-bold mt-0.5 ${
                apartment.lateCancelsLast15d >= 2
                  ? 'text-red-700'
                  : apartment.lateCancelsLast15d === 1
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
            >
              {apartment.lateCancelsLast15d} / 2
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              apartment.nonResidentViolations > 0
                ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            <UserX className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500">Sakini İhlali</span>
            <p
              className={`font-mono text-base sm:text-lg font-bold mt-0.5 ${
                apartment.nonResidentViolations >= 2
                  ? 'text-red-700'
                  : apartment.nonResidentViolations === 1
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
            >
              {apartment.nonResidentViolations}
            </p>
          </div>
        </div>
      </div>

      {/* Active Reservation Card */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-3.5">
        <h2 className="font-display text-base font-bold text-slate-900">
          Mevcut Aktif Rezervasyonunuz
        </h2>
        {activeRes ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-slate-100">
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-900">
                {formatTurkishDateFull(activeRes.dateStr)}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-mono font-bold text-emerald-800">
                  {formatHourRange(activeRes.hour)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {activeRes.playType === 'solo_training'
                    ? 'Bireysel Antrenman'
                    : 'Eşli / Grup Maçı'}
                </span>
                <span aria-hidden="true">·</span>
                <span className={isLateWindow ? 'text-amber-700 font-semibold' : 'text-slate-500'}>
                  {canCancelActive
                    ? isLateWindow
                      ? `Başlangıca ${formatRemainingDuration(activeRes.startMs - nowMs)} (Geç İptal)`
                      : `Ücretsiz iptale ${formatRemainingDuration(activeRes.startMs - nowMs - 4 * 3600000)}`
                    : 'Kullanım saati devam ediyor'}
                </span>
              </div>
            </div>
            {canCancelActive && (
              <button
                type="button"
                onClick={() => onRequestCancel(activeRes)}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Rezervasyonu İptal Et
              </button>
            )}
          </div>
        ) : (
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm text-slate-500">
            <span>Aktif veya yaklaşan kort rezervasyonunuz bulunmuyor.</span>
            <button
              type="button"
              onClick={onGoToSchedule}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl self-start sm:self-auto cursor-pointer"
            >
              Müsait Saatlere Bak
            </button>
          </div>
        )}
      </section>

      {/* Penalties & Warnings Ledger */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Uyarı ve Yaptırım Geçmişi
          </h2>
        </div>
        {penalties.length === 0 ? (
          <div className="p-4 sm:p-6 text-xs sm:text-sm text-slate-500">
            Dairenize ait herhangi bir geç iptal uyarısı veya kural ihlali kaydı bulunmamaktadır.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {penalties.map((p) => (
              <div key={p.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        p.action === 'warning' ? 'text-amber-600' : 'text-red-700'
                      }`}
                      aria-hidden="true"
                    />
                    <span className={p.action === 'warning' ? 'text-amber-800' : 'text-red-800'}>
                      {p.type === 'late_cancellation'
                        ? 'Geç İptal'
                        : 'Daire Sakini Bulunmayan Kullanım'}
                      {' · '}
                      {p.action === 'warning'
                        ? 'Uyarı'
                        : p.action === 'ban_7d'
                        ? '1 Hafta Kısıtlama'
                        : '1 Ay Kısıtlama'}
                    </span>
                    {p.feeAmount && (
                      <span className="font-mono text-red-800">· Ceza: {p.feeAmount}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{p.note}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                  {formatIstanbulDateTime(p.createdAtMs)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reservation History */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Rezervasyon Geçmişi
          </h2>
        </div>
        {reservations.length === 0 ? (
          <div className="p-4 sm:p-6 text-xs sm:text-sm text-slate-500">
            Henüz rezervasyon kaydınız bulunmamaktadır.
          </div>
        ) : (
          <>
            {/* Mobile Boxy Cards */}
            <div className="sm:hidden divide-y divide-slate-200">
              {reservations.map((r) => (
                <div key={r.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-mono text-xs font-bold text-slate-900">
                      {r.dateStr} · {formatHourRange(r.hour)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Eşli / Grup Maçı'}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold whitespace-nowrap ${
                      r.status === 'active'
                        ? 'text-emerald-800'
                        : r.status === 'cancelled_late'
                        ? 'text-amber-800'
                        : 'text-slate-500'
                    }`}
                  >
                    {r.status === 'active'
                      ? r.endMs <= nowMs
                        ? 'Tamamlandı'
                        : 'Aktif'
                      : r.status === 'cancelled_late'
                      ? 'Geç İptal'
                      : 'Ücretsiz İptal'}
                  </span>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Tarih</th>
                    <th className="px-6 py-3 font-medium">Saat</th>
                    <th className="px-6 py-3 font-medium">Tür</th>
                    <th className="px-6 py-3 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {reservations.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 font-mono text-slate-900 whitespace-nowrap">
                        {r.dateStr}
                      </td>
                      <td className="px-6 py-3 font-mono text-slate-700 whitespace-nowrap">
                        {formatHourRange(r.hour)}
                      </td>
                      <td className="px-6 py-3 text-slate-600 whitespace-nowrap">
                        {r.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Eşli / Grup Maçı'}
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        {r.status === 'active' ? (
                          <span className="font-medium text-emerald-800">
                            {r.endMs <= nowMs ? 'Tamamlandı' : 'Aktif'}
                          </span>
                        ) : r.status === 'cancelled_late' ? (
                          <span className="font-medium text-amber-800">Geç İptal</span>
                        ) : (
                          <span className="text-slate-500">Ücretsiz İptal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
