import { jsPDF } from 'jspdf';
import type { SystemBackupPayload } from '../shared/types';
import { formatHourRange, formatIstanbulDateTime } from './api';

const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN_X = 68;
const TOP_START_Y = 76;
const FOOTER_LIMIT_Y = 1648;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const SANS_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return ['—'];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        // Hard-break overly long tokens
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ['—'];
}

function fitSingleLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

export function exportArchiveToPdf(backup: SystemBackupPayload, todayStr: string): void {
  const pages: HTMLCanvasElement[] = [];

  const createPageCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('PDF oluşturma bağlamı başlatılamadı.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    pages.push(canvas);
    return { canvas, ctx };
  };

  let { ctx } = createPageCanvas();
  let y = TOP_START_Y;

  const newPage = (continuationTitle?: string) => {
    ({ ctx } = createPageCanvas());
    y = TOP_START_Y;
    if (continuationTitle) {
      ctx.font = `600 18px ${SANS_FONT}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(continuationTitle, MARGIN_X, y);
      y += 28;
    }
  };

  const ensureSpace = (neededHeight: number, continuationTitle?: string) => {
    if (y + neededHeight > FOOTER_LIMIT_Y) {
      newPage(continuationTitle);
    }
  };

  // Document Header
  ctx.fillStyle = '#065f46';
  ctx.fillRect(MARGIN_X, y - 34, 8, 66);

  ctx.font = `700 15px ${SANS_FONT}`;
  ctx.fillStyle = '#047857';
  ctx.fillText('SOYAK SİESTA SİTE YÖNETİMİ · TENİS KORTU', MARGIN_X + 22, y - 16);

  ctx.font = `700 32px ${SANS_FONT}`;
  ctx.fillStyle = '#0f172a';
  ctx.fillText('Yönetim Arşivi ve Kullanım Raporu', MARGIN_X + 22, y + 22);
  y += 56;

  ctx.font = `500 16px ${SANS_FONT}`;
  ctx.fillStyle = '#475569';
  const dbLabel =
    backup.sourceDatabase === 'postgres' ? 'PostgreSQL (Kalıcı)' : 'Yerel SQLite';
  ctx.fillText(
    `Rapor Tarihi: ${backup.exportedAtLabel}   ·   Veritabanı: ${dbLabel}`,
    MARGIN_X,
    y
  );
  y += 26;

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(PAGE_W - MARGIN_X, y);
  ctx.stroke();
  y += 26;

  // Summary KPI Cards
  const apts = backup.data.apartments;
  const reservations = [...backup.data.reservations].sort(
    (a, b) => b.dateStr.localeCompare(a.dateStr) || b.hour - a.hour || b.id - a.id
  );
  const penalties = [...backup.data.penalties].sort((a, b) => b.createdAtMs - a.createdAtMs);

  const activeCount = reservations.filter((r) => r.status === 'active').length;
  const lateCancelCount = reservations.filter((r) => r.status === 'cancelled_late').length;
  const ontimeCancelCount = reservations.filter((r) => r.status === 'cancelled_ontime').length;

  const kpis = [
    {
      label: 'Kayıtlı Daire',
      value: String(apts.length),
      sub: `${apts.filter((a) => Boolean(a.banUntilMs)).length} kısıtlı daire`,
      accent: '#0f172a',
    },
    {
      label: 'Toplam Rezervasyon',
      value: String(reservations.length),
      sub: `${activeCount} aktif / gerçekleşen`,
      accent: '#047857',
    },
    {
      label: 'İptal Kayıtları',
      value: String(lateCancelCount + ontimeCancelCount),
      sub: `${lateCancelCount} geç · ${ontimeCancelCount} cezasız`,
      accent: '#b45309',
    },
    {
      label: 'Ceza & İhlal',
      value: String(penalties.length),
      sub: `${backup.data.partnerPosts.length} oyun arkadaşı ilanı`,
      accent: '#b91c1c',
    },
  ];

  const kpiGap = 18;
  const kpiW = (CONTENT_W - kpiGap * 3) / 4;
  const kpiH = 104;

  kpis.forEach((k, idx) => {
    const kx = MARGIN_X + idx * (kpiW + kpiGap);
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(kx, y, kpiW, kpiH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.font = `600 14px ${SANS_FONT}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(k.label, kx + 16, y + 28);

    ctx.font = `700 30px ${MONO_FONT}`;
    ctx.fillStyle = k.accent;
    ctx.fillText(k.value, kx + 16, y + 66);

    ctx.font = `500 13px ${SANS_FONT}`;
    ctx.fillStyle = '#475569';
    ctx.fillText(fitSingleLine(ctx, k.sub, kpiW - 32), kx + 16, y + 89);
  });

  y += kpiH + 36;

  const drawSectionHeader = (title: string) => {
    ensureSpace(88);
    ctx.font = `700 22px ${SANS_FONT}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(title, MARGIN_X, y);
    y += 14;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y);
    ctx.lineTo(PAGE_W - MARGIN_X, y);
    ctx.stroke();
    y += 16;
  };

  interface TableCol {
    header: string;
    width: number;
    mono?: boolean;
  }

  const drawTableHeader = (cols: TableCol[]) => {
    const hdrH = 38;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(MARGIN_X, y, CONTENT_W, hdrH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN_X, y, CONTENT_W, hdrH);

    ctx.font = `700 14px ${SANS_FONT}`;
    ctx.fillStyle = '#334155';
    let cx = MARGIN_X + 12;
    for (const col of cols) {
      ctx.fillText(col.header, cx, y + 24);
      cx += col.width;
    }
    y += hdrH;
  };

  // Section 1: Apartments
  drawSectionHeader(`1. Kayıtlı Daireler (${apts.length})`);
  if (apts.length === 0) {
    ctx.font = `500 16px ${SANS_FONT}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText('Kayıtlı daire bulunmamaktadır.', MARGIN_X, y + 20);
    y += 42;
  } else {
    const aptCols: TableCol[] = [
      { header: 'Daire / Blok', width: 280 },
      { header: 'Şifre Durumu', width: 180 },
      { header: 'Durum', width: 180 },
      { header: 'Kısıtlama / Not', width: CONTENT_W - 640 },
    ];
    drawTableHeader(aptCols);

    apts.forEach((apt, idx) => {
      const hasBan = Boolean(apt.banUntilMs && apt.banUntilMs > backup.exportedAtMs);
      const noteText = hasBan
        ? `Bitiş: ${formatIstanbulDateTime(apt.banUntilMs!)} · ${apt.banReason || ''}`
        : 'Aktif kısıtlama yok';
      ctx.font = `500 14px ${SANS_FONT}`;
      const noteLines = wrapTextLines(ctx, noteText, aptCols[3].width - 24);
      const rowH = Math.max(36, noteLines.length * 20 + 16);

      if (y + rowH > FOOTER_LIMIT_Y) {
        newPage('1. Kayıtlı Daireler (devam)');
        drawTableHeader(aptCols);
      }

      if (idx % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(MARGIN_X, y, CONTENT_W, rowH);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, y + rowH);
      ctx.lineTo(PAGE_W - MARGIN_X, y + rowH);
      ctx.stroke();

      let cx = MARGIN_X + 12;
      ctx.font = `700 15px ${SANS_FONT}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(fitSingleLine(ctx, apt.residentLabel, aptCols[0].width - 20), cx, y + 23);
      cx += aptCols[0].width;

      ctx.font = `500 14px ${SANS_FONT}`;
      ctx.fillStyle = apt.passcode || apt.passwordHash ? '#047857' : '#b45309';
      ctx.fillText(apt.passcode || apt.passwordHash ? 'Tanımlı' : 'Atanmamış', cx, y + 23);
      cx += aptCols[1].width;

      ctx.font = `600 14px ${SANS_FONT}`;
      ctx.fillStyle = hasBan ? '#b91c1c' : '#334155';
      ctx.fillText(hasBan ? 'Kısıtlı' : 'Normal', cx, y + 23);
      cx += aptCols[2].width;

      ctx.font = `400 14px ${SANS_FONT}`;
      ctx.fillStyle = hasBan ? '#991b1b' : '#475569';
      noteLines.forEach((line, lIdx) => {
        ctx.fillText(line, cx, y + 23 + lIdx * 20);
      });

      y += rowH;
    });
    y += 32;
  }

  // Section 2: Reservations Archive
  drawSectionHeader(`2. Rezervasyon Arşivi (${reservations.length})`);
  if (reservations.length === 0) {
    ctx.font = `500 16px ${SANS_FONT}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText('Rezervasyon kaydı bulunmamaktadır.', MARGIN_X, y + 20);
    y += 42;
  } else {
    const resCols: TableCol[] = [
      { header: 'ID', width: 84 },
      { header: 'Daire', width: 200 },
      { header: 'Tarih', width: 160 },
      { header: 'Saat', width: 180 },
      { header: 'Oyun Türü', width: 220 },
      { header: 'Durum', width: CONTENT_W - 844 },
    ];
    drawTableHeader(resCols);

    reservations.forEach((r, idx) => {
      const rowH = 36;
      if (y + rowH > FOOTER_LIMIT_Y) {
        newPage('2. Rezervasyon Arşivi (devam)');
        drawTableHeader(resCols);
      }

      if (idx % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(MARGIN_X, y, CONTENT_W, rowH);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, y + rowH);
      ctx.lineTo(PAGE_W - MARGIN_X, y + rowH);
      ctx.stroke();

      let cx = MARGIN_X + 12;
      ctx.font = `600 14px ${MONO_FONT}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(`#${r.id}`, cx, y + 23);
      cx += resCols[0].width;

      ctx.font = `700 14px ${SANS_FONT}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(fitSingleLine(ctx, `Daire ${r.apartmentNo}`, resCols[1].width - 16), cx, y + 23);
      cx += resCols[1].width;

      ctx.font = `500 14px ${MONO_FONT}`;
      ctx.fillStyle = '#334155';
      ctx.fillText(r.dateStr, cx, y + 23);
      cx += resCols[2].width;

      ctx.fillText(formatHourRange(r.hour), cx, y + 23);
      cx += resCols[3].width;

      ctx.font = `500 14px ${SANS_FONT}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(
        r.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Eşli / Grup Maçı',
        cx,
        y + 23
      );
      cx += resCols[4].width;

      ctx.font = `700 14px ${SANS_FONT}`;
      if (r.status === 'active') {
        ctx.fillStyle = '#047857';
        ctx.fillText('Aktif / Geçerli', cx, y + 23);
      } else if (r.status === 'cancelled_late') {
        ctx.fillStyle = '#b45309';
        ctx.fillText('Geç İptal', cx, y + 23);
      } else {
        ctx.fillStyle = '#64748b';
        ctx.fillText('Cezasız İptal', cx, y + 23);
      }

      y += rowH;
    });
    y += 32;
  }

  // Section 3: Penalties Archive
  drawSectionHeader(`3. İhlal ve Geç İptal Kayıtları (${penalties.length})`);
  if (penalties.length === 0) {
    ctx.font = `500 16px ${SANS_FONT}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText('Kayıtlı ihlal veya geç iptal yaptırımı bulunmamaktadır.', MARGIN_X, y + 20);
    y += 42;
  } else {
    const penCols: TableCol[] = [
      { header: 'Tarih / Saat', width: 200 },
      { header: 'Daire', width: 150 },
      { header: 'Yaptırım', width: 240 },
      { header: 'Açıklama ve Ücret', width: CONTENT_W - 590 },
    ];
    drawTableHeader(penCols);

    penalties.forEach((p, idx) => {
      const fullNote = p.feeAmount ? `${p.note} (Ücret: ${p.feeAmount})` : p.note;
      ctx.font = `400 14px ${SANS_FONT}`;
      const noteLines = wrapTextLines(ctx, fullNote, penCols[3].width - 24);
      const rowH = Math.max(38, noteLines.length * 20 + 16);

      if (y + rowH > FOOTER_LIMIT_Y) {
        newPage('3. İhlal ve Geç İptal Kayıtları (devam)');
        drawTableHeader(penCols);
      }

      if (idx % 2 === 1) {
        ctx.fillStyle = '#fef2f2';
        ctx.fillRect(MARGIN_X, y, CONTENT_W, rowH);
      }
      ctx.strokeStyle = '#fecaca';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, y + rowH);
      ctx.lineTo(PAGE_W - MARGIN_X, y + rowH);
      ctx.stroke();

      let cx = MARGIN_X + 12;
      ctx.font = `500 13px ${MONO_FONT}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(fitSingleLine(ctx, formatIstanbulDateTime(p.createdAtMs), penCols[0].width - 16), cx, y + 23);
      cx += penCols[0].width;

      ctx.font = `700 14px ${SANS_FONT}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(fitSingleLine(ctx, `Daire ${p.apartmentNo}`, penCols[1].width - 16), cx, y + 23);
      cx += penCols[1].width;

      const typeLabel = p.type === 'late_cancellation' ? 'Geç İptal' : 'Sakini İhlali';
      const actionLabel =
        p.action === 'warning' ? 'Uyarı' : p.action === 'ban_7d' ? '1 Hafta Ban' : '1 Ay Ban';
      ctx.font = `700 14px ${SANS_FONT}`;
      ctx.fillStyle = p.action === 'warning' ? '#b45309' : '#b91c1c';
      ctx.fillText(fitSingleLine(ctx, `${typeLabel} · ${actionLabel}`, penCols[2].width - 16), cx, y + 23);
      cx += penCols[2].width;

      ctx.font = `400 14px ${SANS_FONT}`;
      ctx.fillStyle = '#334155';
      noteLines.forEach((line, lIdx) => {
        ctx.fillText(line, cx, y + 23 + lIdx * 20);
      });

      y += rowH;
    });
  }

  // Stamp consistent footers with total page count
  const totalPages = pages.length;
  pages.forEach((canvas, idx) => {
    const pCtx = canvas.getContext('2d');
    if (!pCtx) return;
    pCtx.strokeStyle = '#e2e8f0';
    pCtx.lineWidth = 1;
    pCtx.beginPath();
    pCtx.moveTo(MARGIN_X, PAGE_H - 72);
    pCtx.lineTo(PAGE_W - MARGIN_X, PAGE_H - 72);
    pCtx.stroke();

    pCtx.font = `500 13px ${SANS_FONT}`;
    pCtx.fillStyle = '#64748b';
    pCtx.fillText('Soyak Siesta Tenis Kortu · Yönetim Arşivi', MARGIN_X, PAGE_H - 44);

    const pageLabel = `Sayfa ${idx + 1} / ${totalPages}`;
    const labelW = pCtx.measureText(pageLabel).width;
    pCtx.fillText(pageLabel, PAGE_W - MARGIN_X - labelW, PAGE_H - 44);
  });

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  pages.forEach((canvas, idx) => {
    if (idx > 0) doc.addPage('a4', 'portrait');
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  });

  doc.save(`soyak-siesta-arsiv-${todayStr}.pdf`);
}
