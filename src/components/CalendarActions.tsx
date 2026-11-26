import { BellRing, CalendarPlus, Download, ExternalLink } from 'lucide-react';
import {
  buildGoogleCalendarUrl,
  downloadIcsCalendarEvent,
  type CalendarReservationInput,
} from '../lib/calendar';

interface CalendarActionsProps {
  reservation: CalendarReservationInput;
  compact?: boolean;
}

export function CalendarActions({ reservation, compact = false }: CalendarActionsProps) {
  const googleUrl = buildGoogleCalendarUrl(reservation);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-start gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
        <BellRing className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="leading-snug">
          Takvim dosyası (.ics) iki otomatik hatırlatıcı içerir:{' '}
          <strong className="font-semibold text-slate-900">
            cezasız iptal saatinden 1 saat önce
          </strong>{' '}
          (maçtan 4 saat önce) ve{' '}
          <strong className="font-semibold text-slate-900">oyun saatinden 1 saat önce</strong>.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => downloadIcsCalendarEvent(reservation)}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>iPhone / Android / Windows (.ics)</span>
        </button>

        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors whitespace-nowrap"
        >
          <CalendarPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Google Takvim&apos;e Ekle</span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
