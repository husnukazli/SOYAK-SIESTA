import { useEffect, useState } from 'react';
import { CalendarCheck, CheckCircle2, Info, User, Users, X } from 'lucide-react';
import { api, ApiError, formatTurkishDateFull } from '../lib/api';
import type { PlayType, ReservationItem, ScheduleSlot } from '../shared/types';
import { CalendarActions } from './CalendarActions';

interface BookingModalProps {
  slot: ScheduleSlot | null;
  dateStr: string;
  apartmentNo: string;
  token: string;
  reservedByOtherApt?: string | null;
  onClose: () => void;
  onBooked: (notice: string) => void;
}

export function BookingModal({
  slot,
  dateStr,
  apartmentNo,
  token,
  reservedByOtherApt,
  onClose,
  onBooked,
}: BookingModalProps) {
  const [playType, setPlayType] = useState<PlayType>('match');
  const [residentConfirmed, setResidentConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedReservation, setConfirmedReservation] = useState<ReservationItem | null>(null);

  const slotHour = slot?.hour ?? null;
  useEffect(() => {
    setPlayType('match');
    setResidentConfirmed(false);
    setError(null);
    setConfirmedReservation(null);
  }, [slotHour, dateStr]);

  if (!slot) return null;

  const isPrime = slot.primeTime;
  const overrideUsed = slot.eligibility?.primeOverrideUsed ?? false;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!residentConfirmed) {
      setError('Kortu kullanan kişilerden en az birinin daire sakini olduğunu onaylamalısınız.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const effectivePlayType: PlayType = isPrime ? 'match' : playType;
      const result = await api.createReservation(token, {
        dateStr,
        hour: slot.hour,
        playType: effectivePlayType,
        residentConfirmed: true,
      });
      setConfirmedReservation(result.reservation);
      onBooked(
        `${formatTurkishDateFull(dateStr)} · ${slot.label} için Daire ${apartmentNo} rezervasyonunuz oluşturuldu.`
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Rezervasyon kaydedilirken bir hata oluştu.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              {confirmedReservation ? (
                <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
              ) : (
                <CalendarCheck className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <h2 id="booking-modal-title" className="font-display text-base font-bold text-slate-900">
              {confirmedReservation ? 'Rezervasyonunuz Oluşturuldu' : 'Kort Rezervasyonu'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Pencereyi kapat"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-xl hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {confirmedReservation ? (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1.5">
              <div className="flex items-center justify-between text-xs text-emerald-800">
                <span className="font-bold">Daire {confirmedReservation.apartmentNo}</span>
                <span className="font-medium">
                  {confirmedReservation.playType === 'solo_training'
                    ? 'Bireysel Antrenman'
                    : 'Eşli / Grup Maçı'}
                </span>
              </div>
              <p className="font-display text-lg font-bold text-slate-900">
                {formatTurkishDateFull(confirmedReservation.dateStr)}
              </p>
              <p className="font-mono text-lg font-bold text-emerald-800">{slot.label}</p>
            </div>

            <div className="p-4 bg-white border-2 border-emerald-700/20 rounded-2xl space-y-3">
              <div>
                <p className="font-display text-sm sm:text-base font-bold text-slate-900">
                  Hemen Ajandanıza Kaydedin
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Unutmamak için randevunuzu tek dokunuşla telefon veya bilgisayar takviminize ekleyin.
                </p>
              </div>
              <CalendarActions reservation={confirmedReservation} />
            </div>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] w-full px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer"
            >
              Tamam, Programa Dön
            </button>
          </div>
        ) : (
          <form onSubmit={handleConfirm} className="p-5 sm:p-6 space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-700">Daire {apartmentNo}</span>
                <span>{isPrime ? 'Yoğun Saat (18:00 - 21:00)' : 'Normal Saat'}</span>
              </div>
              <p className="font-display text-base font-bold text-slate-900">
                {formatTurkishDateFull(dateStr)}
              </p>
              <p className="font-mono text-base font-bold text-emerald-800">{slot.label}</p>
            </div>

            {overrideUsed && (
              <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden="true" />
                <p>
                  Saat 15:00 sonrasında yoğun saat dilimi boş olduğu için üst üste gün kuralı istisnası kapsamında rezerve edilebilir durumdadır.
                </p>
              </div>
            )}

            {/* Boxy Play Type Tiles */}
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-700">Kullanım Şekli</span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setPlayType('match')}
                  className={`p-3.5 min-h-[88px] text-left rounded-2xl border transition-colors cursor-pointer flex flex-col justify-between gap-2 ${
                    playType === 'match' || isPrime
                      ? 'border-emerald-700 bg-emerald-50/70 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="w-8 h-8 rounded-xl bg-emerald-700 text-white flex items-center justify-center">
                    <Users className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-bold">Eşli / Grup Maçı</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">En az 1 daire sakini</p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isPrime}
                  onClick={() => setPlayType('solo_training')}
                  className={`p-3.5 min-h-[88px] text-left rounded-2xl border transition-colors flex flex-col justify-between gap-2 ${
                    isPrime
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                      : playType === 'solo_training'
                      ? 'border-emerald-700 bg-emerald-50/70 text-slate-900 cursor-pointer'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 cursor-pointer'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                      isPrime
                        ? 'bg-slate-200 text-slate-400'
                        : playType === 'solo_training'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <User className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-bold">Bireysel Antrenman</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isPrime ? 'Yoğun saatte kapalı' : 'Tek başına çalışma'}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <label className="flex items-start gap-3 p-3.5 border border-slate-200 rounded-2xl bg-white cursor-pointer hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={residentConfirmed}
                onChange={(e) => setResidentConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700 shrink-0"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                Kortu kullanan kişilerden en az birinin <strong className="font-semibold text-slate-900">Daire {apartmentNo}</strong> sakini olacağını, aksi tespitte ilk seferde uyarı, tekrarında 1 ay rezervasyon iptali ve yönetim inisiyatifiyle ücretli ceza uygulanacağını kabul ediyorum.
              </span>
            </label>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Başlangıç saatinden 4 saat öncesine kadar cezasız iptal edilebilir. Onay sonrası rezervasyonunuzu 2 hatırlatıcı ile ajandanıza ekleyebilirsiniz.
            </p>

            {reservedByOtherApt && (
              <div role="alert" className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 font-medium">
                Bu saat dilimi az önce Daire {reservedByOtherApt} tarafından rezerve edildi. Lütfen başka bir saat seçin.
              </div>
            )}

            {error && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[48px] px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={loading || !residentConfirmed || Boolean(reservedByOtherApt)}
                className="min-h-[48px] px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                {loading ? 'Kaydediliyor...' : 'Onayla'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
