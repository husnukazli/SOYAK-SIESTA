import { useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import {
  api,
  ApiError,
  formatHourRange,
  formatRemainingDuration,
  formatTurkishDateFull,
} from '../lib/api';

interface CancelTarget {
  id: number;
  dateStr: string;
  hour: number;
  startMs: number;
}

interface CancelModalProps {
  target: CancelTarget | null;
  nowMs: number;
  lateCancelsLast15d: number;
  token: string;
  onClose: () => void;
  onCancelled: (message: string, isLate: boolean) => void;
}

export function CancelModal({
  target,
  nowMs,
  lateCancelsLast15d,
  token,
  onClose,
  onCancelled,
}: CancelModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  const remainingMs = target.startMs - nowMs;
  const hoursRemaining = remainingMs / (60 * 60 * 1000);
  const isAlreadyStarted = remainingMs <= 0;
  const isLate = hoursRemaining < 4;
  const willTriggerBan = isLate && lateCancelsLast15d >= 1;

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.cancelReservation(token, target.id);
      onCancelled(res.message, res.lateCancel);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('İptal işlemi sırasında bir hata oluştu.');
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
      aria-labelledby="cancel-modal-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="cancel-modal-title" className="font-display text-base font-semibold text-slate-900">
            Rezervasyon İptali
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Pencereyi kapat"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              {formatTurkishDateFull(target.dateStr)}
            </p>
            <p className="font-mono text-xs text-slate-700">{formatHourRange(target.hour)}</p>
            <p className="font-mono text-xs text-slate-500 pt-1">
              Başlangıca kalan süre: {formatRemainingDuration(remainingMs)}
            </p>
          </div>

          {isAlreadyStarted ? (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              Başlangıç saati gelmiş veya geçmiş rezervasyonlar iptal edilemez.
            </div>
          ) : isLate ? (
            <div
              className={`p-4 rounded-lg border text-xs space-y-1.5 ${
                willTriggerBan
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {willTriggerBan
                    ? 'Geç İptal — 1 Haftalık Kısıtlama Uygulanacak'
                    : 'Geç İptal Uyarısı (4 Saatten Az Süre)'}
                </span>
              </div>
              <p className="leading-relaxed">
                {willTriggerBan
                  ? 'Son 15 gün içinde zaten 1 geç iptal kaydınız bulunuyor. Bu rezervasyonu şimdi iptal etmeniz halinde dairenize 1 haftalık rezervasyon hakkı iptali uygulanacaktır.'
                  : 'Rezervasyon saatine 4 saatten az süre kaldığı için bu işlem geç iptal sayılacaktır. 15 günlük süreçteki ilk geç iptal için uyarı verilir; tekrarı halinde 1 haftalık rezervasyon hakkı iptal edilir.'}
              </p>
            </div>
          ) : (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" aria-hidden="true" />
              <p className="leading-relaxed">
                Başlangıç saatine 4 saatten fazla süre bulunduğu için iptal işlemi ücretsiz ve cezasız yapılacaktır.
              </p>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={loading || isAlreadyStarted}
              onClick={handleConfirm}
              className={`px-5 py-2.5 text-xs font-semibold text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer ${
                isLate
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              {loading
                ? 'İptal Ediliyor...'
                : isLate
                ? 'Geç İptali Onayla'
                : 'Rezervasyonu İptal Et'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
