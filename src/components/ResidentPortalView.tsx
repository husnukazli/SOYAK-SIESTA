import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck, ShieldAlert } from 'lucide-react';
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
      <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
        <CalendarCheck className="w-8 h-8 text-emerald-700 mx-auto" aria-hidden="true" />
        <h1 className="font-display text-xl font-bold text-slate-900">
          Daire Rezervasyonları ve Ceza Durumu
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Aktif rezervasyonunuzu görüntülemek, iptal etmek veya 15 günlük geç iptal ve kullanım kayıtlarınızı incelemek için daire şifrenizle giriş yapın.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onOpenResidentLogin}
            className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            Daire Girişi Yap
          </button>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-28 bg-white border border-slate-200 rounded-xl" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {apartment.residentLabel} · Rezervasyon Özeti
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Son 15 günlük geç iptal ve daire sakini denetim sicili aşağıda yer almaktadır.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSchedule}
          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          Kort Programına Dön
        </button>
      </div>

      {/* Ban Banner if restricted */}
      {apartment.banUntilMs && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-900">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">Rezervasyon Hakkı Geçici Olarak Kısıtlıdır</p>
            <p className="text-xs leading-relaxed">
              {apartment.banReason} · Kısıtlama bitiş tarihi:{' '}
              <strong className="font-mono">{formatIstanbulDateTime(apartment.banUntilMs)}</strong>
            </p>
          </div>
        </div>
      )}

      {/* 4-column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs text-slate-500">Hesap Durumu</span>
          <p
            className={`font-display text-lg font-bold ${
              apartment.banUntilMs ? 'text-red-700' : 'text-emerald-800'
            }`}
          >
            {apartment.banUntilMs ? 'Kısıtlı' : 'Aktif / Uygun'}
          </p>
          <p className="text-[11px] text-slate-500">
            {apartment.banUntilMs
              ? `Bitiş: ${formatIstanbulDateTime(apartment.banUntilMs)}`
              : 'Rezervasyon oluşturabilir'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs text-slate-500">Aktif Rezervasyon</span>
          <p className="font-mono text-lg font-bold text-slate-900">
            {activeRes ? formatHourRange(activeRes.hour) : 'Yok'}
          </p>
          <p className="text-[11px] text-slate-500">
            {activeRes ? activeRes.dateStr : 'Aynı gün en fazla 1 kayıt'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs text-slate-500">15 Günlük Geç İptal</span>
          <p
            className={`font-mono text-lg font-bold ${
              apartment.lateCancelsLast15d >= 2
                ? 'text-red-700'
                : apartment.lateCancelsLast15d === 1
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {apartment.lateCancelsLast15d} / 2
          </p>
          <p className="text-[11px] text-slate-500">
            {apartment.lateCancelsLast15d === 1
              ? 'Uyarı mevcut · Tekrarda 1 hafta iptal'
              : apartment.lateCancelsLast15d >= 2
              ? 'Tekrarlanan geç iptal cezası'
              : '4 saat öncesi ücretsiz iptal'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs text-slate-500">Daire Sakini İhlali</span>
          <p
            className={`font-mono text-lg font-bold ${
              apartment.nonResidentViolations >= 2
                ? 'text-red-700'
                : apartment.nonResidentViolations === 1
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {apartment.nonResidentViolations}
          </p>
          <p className="text-[11px] text-slate-500">
            1. tespit uyarı · Tekrarı 1 ay + ücretli ceza
          </p>
        </div>
      </div>

      {/* Active Reservation Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Mevcut Aktif Rezervasyonunuz
        </h2>
        {activeRes ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {formatTurkishDateFull(activeRes.dateStr)}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-mono font-semibold text-emerald-800">
                  {formatHourRange(activeRes.hour)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {activeRes.playType === 'solo_training'
                    ? 'Bireysel Antrenman'
                    : 'Eşli / Grup Maçı'}
                </span>
                <span aria-hidden="true">·</span>
                <span className={isLateWindow ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                  {canCancelActive
                    ? isLateWindow
                      ? `Başlangıca ${formatRemainingDuration(activeRes.startMs - nowMs)} (Geç İptal Dilimi)`
                      : `Ücretsiz iptale ${formatRemainingDuration(activeRes.startMs - nowMs - 4 * 3600000)} kaldı`
                    : 'Kullanım saati devam ediyor'}
                </span>
              </div>
            </div>
            {canCancelActive && (
              <button
                type="button"
                onClick={() => onRequestCancel(activeRes)}
                className="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Rezervasyonu İptal Et
              </button>
            )}
          </div>
        ) : (
          <div className="py-4 text-sm text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
            <span>Şu anda aktif veya yaklaşan bir kort rezervasyonunuz bulunmuyor.</span>
            <button
              type="button"
              onClick={onGoToSchedule}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline self-start sm:self-auto cursor-pointer"
            >
              Müsait Saatlere Bak
            </button>
          </div>
        )}
      </section>

      {/* Penalties & Warnings Ledger */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Uyarı ve Yaptırım Geçmişi
          </h2>
        </div>
        {penalties.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Dairenize ait herhangi bir geç iptal uyarısı veya kural ihlali kaydı bulunmamaktadır.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {penalties.map((p) => (
              <div key={p.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <AlertTriangle
                      className={`w-3.5 h-3.5 ${
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
                        ? '1 Hafta Rezervasyon İptali'
                        : '1 Ay Rezervasyon İptali'}
                    </span>
                    {p.feeAmount && (
                      <span className="font-mono text-red-800">· Ücretli Ceza: {p.feeAmount}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{p.note}</p>
                </div>
                <span className="font-mono text-xs text-slate-500 whitespace-nowrap shrink-0">
                  {formatIstanbulDateTime(p.createdAtMs)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reservation History Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Rezervasyon Geçmişi
          </h2>
        </div>
        {reservations.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Henüz rezervasyon kaydınız bulunmamaktadır.
          </div>
        ) : (
          <div className="overflow-x-auto">
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
        )}
      </section>
    </div>
  );
}
