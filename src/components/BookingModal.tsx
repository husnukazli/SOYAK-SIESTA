import { useState } from 'react';
import { CalendarCheck, Info, X } from 'lucide-react';
import { api, ApiError, formatTurkishDateFull } from '../lib/api';
import type { PlayType, ScheduleSlot } from '../shared/types';

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

  if (!slot) return null;

  const isPrime = slot.primeTime;
  const overrideUsed = slot.eligibility?.sixteenHourOverrideUsed ?? false;

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
      await api.createReservation(token, {
        dateStr,
        hour: slot.hour,
        playType: effectivePlayType,
        residentConfirmed: true,
      });
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <CalendarCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            <h2 id="booking-modal-title" className="font-display text-base font-semibold text-slate-900">
              Kort Rezervasyonu Oluştur
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Pencereyi kapat"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirm} className="p-6 space-y-5">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Daire {apartmentNo}</span>
              <span>{isPrime ? 'Yoğun Saat (18:00 - 21:00)' : 'Normal Saat'}</span>
            </div>
            <p className="font-display text-base font-semibold text-slate-900">
              {formatTurkishDateFull(dateStr)}
            </p>
            <p className="font-mono text-sm font-medium text-emerald-800">{slot.label}</p>
          </div>

          {overrideUsed && (
            <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden="true" />
              <p>
                Saat 16:00 sonrasında yoğun saat dilimi boş olduğu için üst üste gün kuralı istisnası kapsamında rezerve edilebilir durumdadır.
              </p>
            </div>
          )}

          {/* Play Type selection */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-700">Kullanım Şekli</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPlayType('match')}
                className={`p-3 text-left rounded-lg border transition-colors cursor-pointer ${
                  playType === 'match' || isPrime
                    ? 'border-emerald-700 bg-emerald-50/60 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <p className="text-xs font-semibold">Eşli / Grup Maçı</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  En az 1 daire sakini katılımı zorunludur.
                </p>
              </button>

              <button
                type="button"
                disabled={isPrime}
                onClick={() => setPlayType('solo_training')}
                className={`p-3 text-left rounded-lg border transition-colors ${
                  isPrime
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : playType === 'solo_training'
                    ? 'border-emerald-700 bg-emerald-50/60 text-slate-900 cursor-pointer'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 cursor-pointer'
                }`}
              >
                <p className="text-xs font-semibold">Bireysel Antrenman</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {isPrime
                    ? '18:00–21:00 yoğun saatlerinde kapalıdır.'
                    : 'Tek başına antrenman amaçlı kullanım.'}
                </p>
              </button>
            </div>
          </div>

          {/* Mandatory resident confirmation */}
          <label className="flex items-start gap-3 p-3.5 border border-slate-200 rounded-lg bg-white cursor-pointer hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={residentConfirmed}
              onChange={(e) => setResidentConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
            />
            <span className="text-xs text-slate-700 leading-relaxed">
              Kortu kullanan kişilerden en az birinin <strong className="font-semibold text-slate-900">Daire {apartmentNo}</strong> sakini olacağını, aksi tespitte ilk seferde uyarı, tekrarında 1 ay rezervasyon iptali ve yönetim inisiyatifiyle ücretli ceza uygulanacağını kabul ediyorum.
            </span>
          </label>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Rezervasyon en geç başlangıç saatinden 4 saat öncesine kadar cezasız iptal edilebilir. 4 saatten kısa sürede yapılan iptaller geç iptal sayılır.
          </p>

          {reservedByOtherApt && (
            <div role="alert" className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 font-medium">
              Bu saat dilimi az önce Daire {reservedByOtherApt} tarafından rezerve edildi. Lütfen başka bir saat dilimi seçin.
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={loading || !residentConfirmed || Boolean(reservedByOtherApt)}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {loading ? 'Kaydediliyor...' : 'Rezervasyonu Onayla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
