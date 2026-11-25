import type { PlayType } from '../shared/types';
import { formatHourRange } from './api';

export interface CalendarReservationInput {
  id?: number;
  dateStr: string;
  hour: number;
  startMs: number;
  endMs: number;
  apartmentNo: string;
  playType: PlayType;
}

function toUtcIcsTimestamp(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildGoogleCalendarUrl(res: CalendarReservationInput): string {
  const playLabel =
    res.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Eşli / Grup Maçı';
  const title = `Soyak Siesta Tenis · ${formatHourRange(res.hour)}`;
  const details = [
    `Daire: ${res.apartmentNo}`,
    `Kullanım Türü: ${playLabel}`,
    `Ücretsiz İptal Son Saati: Oyun saatinden 4 saat önce (öncesinde 1 saat kala hatırlatıcı kurmanız önerilir).`,
  ].join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toUtcIcsTimestamp(res.startMs)}/${toUtcIcsTimestamp(res.endMs)}`,
    details,
    location: 'Soyak Siesta Tenis Kortu',
    ctz: 'Europe/Istanbul',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcsCalendarEvent(res: CalendarReservationInput): void {
  const playLabel =
    res.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Eşli / Grup Maçı';
  const summary = `Soyak Siesta Tenis (${res.apartmentNo})`;
  const description = [
    `Daire: ${res.apartmentNo}`,
    `Saat: ${formatHourRange(res.hour)}`,
    `Kullanım: ${playLabel}`,
    'Hatırlatma 1: Cezasız iptal süresinin bitimine 1 saat kala (maçtan 5 saat önce).',
    'Hatırlatma 2: Oyun saatinden 1 saat önce.',
  ].join('\n');

  const uid = `soyak-siesta-tenis-${res.id ?? `${res.dateStr}-${res.hour}`}-${res.startMs}@soyaksiestatenis`;
  const dtStamp = toUtcIcsTimestamp(Date.now());
  const dtStart = toUtcIcsTimestamp(res.startMs);
  const dtEnd = toUtcIcsTimestamp(res.endMs);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Soyak Siesta Tenis//Kort Rezervasyonu//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText('Soyak Siesta Tenis Kortu')}`,
    'STATUS:CONFIRMED',
    // Alarm 1: 1 hour before the 4-hour free cancellation deadline (= 5 hours before match start)
    'BEGIN:VALARM',
    'TRIGGER:-PT5H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText('Ücretsiz iptal süresinin bitmesine 1 saat kaldı (Soyak Siesta Tenis).')}`,
    'END:VALARM',
    // Alarm 2: 1 hour before match start
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText('Soyak Siesta Tenis kortu randevunuza 1 saat kaldı.')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([lines.join('\r\n')], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `soyak-siesta-tenis-${res.dateStr}-${String(res.hour).padStart(2, '0')}00.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
