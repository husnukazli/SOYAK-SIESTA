import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Dumbbell,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  addDaysToDateStr,
  api,
  ApiError,
  formatIstanbulDateTime,
  formatTurkishDateShort,
  getTodayIstanbulDateStr,
  pad2,
} from '../lib/api';
import type {
  AuthSession,
  PartnerBoardResponse,
  PartnerFormat,
  PartnerPostItem,
} from '../shared/types';

interface PartnerBoardViewProps {
  session: AuthSession | null;
  onOpenResidentLogin: () => void;
  refreshTrigger: number;
}

const SKILL_LEVELS: { level: number; shortLabel: string; description: string }[] = [
  { level: 1, shortLabel: 'Yeni Başlayan', description: 'Temel vuruşları öğreniyor' },
  { level: 2, shortLabel: 'Başlangıç', description: 'Kısa ralli yapabiliyor' },
  { level: 3, shortLabel: 'Orta-Başlangıç', description: 'Servis ve temel ralli istikrarı' },
  { level: 4, shortLabel: 'Orta Seviye', description: 'Düzenli ralli ve maç tecrübesi' },
  { level: 5, shortLabel: 'Orta-İleri', description: 'Taktik oyun, güçlü servis ve file' },
  { level: 6, shortLabel: 'İleri Seviye', description: 'Yüksek tempo / turnuva düzeyi' },
  { level: 7, shortLabel: 'Pro / Müsabaka', description: 'Üst düzey rekabetçi seviye' },
];

const FORMAT_OPTIONS: {
  id: PartnerFormat;
  label: string;
  Icon: typeof Trophy;
}[] = [
  { id: 'match', label: 'Maç', Icon: Trophy },
  { id: 'training', label: 'Antrenman', Icon: Dumbbell },
  { id: 'rally', label: 'Ralli', Icon: Activity },
];

export function PartnerBoardView({
  session,
  onOpenResidentLogin,
  refreshTrigger,
}: PartnerBoardViewProps) {
  const [board, setBoard] = useState<PartnerBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [formatFilter, setFormatFilter] = useState<'all' | PartnerFormat>('all');
  const [levelFilter, setLevelFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');

  // Shared nickname kept in React state for convenience during session
  const [nickname, setNickname] = useState('');

  // Create listing sheet state
  const [createOpen, setCreateOpen] = useState(false);
  const [skillLevel, setSkillLevel] = useState<number>(4);
  const [sessionFormat, setSessionFormat] = useState<PartnerFormat>('match');
  const [dateStr, setDateStr] = useState<string>(() => getTodayIstanbulDateStr());
  const [startHour, setStartHour] = useState<number>(19);
  const [endHour, setEndHour] = useState<number>(20);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reply state per post
  const [replyOpenPostId, setReplyOpenPostId] = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    setLoading((prev) => (board === null ? true : prev));
    setError(null);
    try {
      const token = session?.role === 'resident' ? session.token : null;
      const res = await api.getPartnerBoard(token);
      setBoard(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'İlanlar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadBoard();
  }, [loadBoard, refreshTrigger]);

  const todayStr = board?.todayStr || getTodayIstanbulDateStr();
  const dateOptions = Array.from({ length: 8 }, (_, i) => {
    const d = addDaysToDateStr(todayStr, i);
    const { weekday, dayMonth } = formatTurkishDateShort(d);
    return {
      dateStr: d,
      label: i === 0 ? `Bugün (${dayMonth})` : i === 1 ? `Yarın (${dayMonth})` : `${weekday} (${dayMonth})`,
    };
  });

  const handleStartHourChange = (nextStart: number) => {
    setStartHour(nextStart);
    if (endHour <= nextStart) {
      setEndHour(Math.min(23, nextStart + 1));
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || session.role !== 'resident') {
      onOpenResidentLogin();
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await api.createPartnerPost(session.token, {
        nickname: nickname.trim(),
        skillLevel,
        sessionFormat,
        dateStr,
        startHour,
        endHour,
        note: note.trim() || undefined,
      });
      setNote('');
      setCreateOpen(false);
      await loadBoard();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'İlan yayınlanamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent, postId: number) => {
    e.preventDefault();
    if (!session || session.role !== 'resident') {
      onOpenResidentLogin();
      return;
    }
    setReplyError(null);
    setReplySubmitting(true);
    try {
      await api.replyPartnerPost(session.token, postId, {
        nickname: nickname.trim(),
        message: replyMessage.trim(),
      });
      setReplyMessage('');
      setReplyOpenPostId(null);
      await loadBoard();
    } catch (err) {
      setReplyError(err instanceof ApiError ? err.message : 'Cevap gönderilemedi.');
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleToggleStatus = async (post: PartnerPostItem) => {
    if (!session || session.role !== 'resident') return;
    const nextStatus = post.status === 'open' ? 'matched' : 'open';
    try {
      await api.updatePartnerPostStatus(session.token, post.id, nextStatus);
      await loadBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Durum güncellenemedi.');
    }
  };

  const handleDeletePost = async (postId: number) => {
    if (!session) return;
    try {
      await api.deletePartnerPost(session.token, postId);
      await loadBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'İlan silinemedi.');
    }
  };

  const posts = (board?.posts ?? []).filter((p) => {
    if (statusFilter === 'open' && p.status !== 'open') return false;
    if (formatFilter !== 'all' && p.sessionFormat !== formatFilter) return false;
    if (levelFilter !== 'all' && p.skillLevel !== levelFilter) return false;
    return true;
  });

  const getLevelInfo = (lvl: number) =>
    SKILL_LEVELS.find((s) => s.level === lvl) ?? SKILL_LEVELS[3];

  const getFormatMeta = (fmt: PartnerFormat) =>
    FORMAT_OPTIONS.find((f) => f.id === fmt) ?? FORMAT_OPTIONS[0];

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header Banner */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shrink-0">
            <Users className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-lg sm:text-2xl font-bold text-slate-900">
              Oyun Arkadaşı Arayanlar
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-2xl">
              Seviyenize (1–7) ve tercih ettiğiniz saate göre takma ad (nickname) ile ilan açın veya komşularınızın ilanlarına cevap yazın. Gizlilik için daire numaranız paylaşılmaz.
            </p>
          </div>
        </div>

        {session?.role === 'resident' ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Oyun Arkadaşı İlanı Oluştur</span>
          </button>
        ) : session?.role === 'admin' ? (
          <span className="text-xs text-slate-500 whitespace-nowrap">
            İlan açmak için daire girişi gerekir
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenResidentLogin}
            className="min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Giriş Yap ve İlan Aç</span>
          </button>
        )}
      </section>

      {/* Filter Bar */}
      <section className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFormatFilter('all')}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border cursor-pointer ${
              formatFilter === 'all'
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Tümü
          </button>
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFormatFilter(opt.id)}
              className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border cursor-pointer ${
                formatFilter === opt.id
                  ? 'bg-emerald-700 border-emerald-700 text-white'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Seviye filtresi"
            value={levelFilter}
            onChange={(e) =>
              setLevelFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
          >
            <option value="all">Tüm Seviyeler (1–7)</option>
            {SKILL_LEVELS.map((s) => (
              <option key={s.level} value={s.level}>
                Seviye {s.level} · {s.shortLabel}
              </option>
            ))}
          </select>

          <select
            aria-label="Durum filtresi"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'open' | 'all')}
            className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
          >
            <option value="open">Açık İlanlar</option>
            <option value="all">Tüm İlanlar</option>
          </select>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Listings Grid */}
      {loading && !board ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-44 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" aria-hidden="true" />
          </div>
          <p className="font-display text-base font-bold text-slate-900">
            Seçili kriterlere uygun ilan bulunmuyor
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            İlk oyun arkadaşı ilanını oluşturarak seviyenizi, oyun türünüzü ve uygun olduğunuz saat aralığını paylaşabilirsiniz.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map((post) => {
            const lvl = getLevelInfo(post.skillLevel);
            const fmt = getFormatMeta(post.sessionFormat);
            const FormatIcon = fmt.Icon;
            const { weekday, dayMonth } = formatTurkishDateShort(post.dateStr);
            const isReplyOpen = replyOpenPostId === post.id;

            return (
              <article
                key={post.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 ${
                  post.status === 'matched'
                    ? 'border-emerald-300 bg-emerald-50/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="space-y-3">
                  {/* Top Row: Level Box + Nickname + Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex flex-col items-center justify-center shrink-0">
                        <span className="text-[9px] font-medium text-slate-300 leading-none">
                          SEVİYE
                        </span>
                        <span className="font-mono text-lg font-bold leading-tight">
                          {post.skillLevel}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="font-display text-base font-bold text-slate-900 truncate">
                            {post.nickname}
                          </h2>
                          {post.isOwn && (
                            <span className="text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
                              (Sizin İlanınız)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {lvl.shortLabel} · {fmt.label}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {post.status === 'matched' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800">
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span>Partner Bulundu</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <FormatIcon className="w-4 h-4" aria-hidden="true" />
                          <span>Aranıyor</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Time & Format Box */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="block text-[10px] font-medium text-slate-500">Tarih</span>
                      <span className="font-mono text-xs sm:text-sm font-bold text-slate-900">
                        {dayMonth} · {weekday}
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="block text-[10px] font-medium text-slate-500">Saat Aralığı</span>
                      <span className="font-mono text-xs sm:text-sm font-bold text-emerald-800">
                        {pad2(post.startHour)}:00 - {pad2(post.endHour)}:00
                      </span>
                    </div>
                  </div>

                  {post.note && (
                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-slate-50/70 rounded-xl p-3 border border-slate-100">
                      {post.note}
                    </p>
                  )}
                </div>

                {/* Replies Thread */}
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  {post.replies.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-slate-500">
                        Cevaplar ({post.replies.length})
                      </p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {post.replies.map((reply) => (
                          <div
                            key={reply.id}
                            className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-0.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900">
                                {reply.nickname}
                                {reply.isOwn ? ' (Siz)' : ''}
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">
                                {formatIstanbulDateTime(reply.createdAtMs)}
                              </span>
                            </div>
                            <p className="text-slate-700 leading-snug">{reply.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inline Reply Composer */}
                  {isReplyOpen && session?.role === 'resident' && (
                    <form
                      onSubmit={(e) => handleSendReply(e, post.id)}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5"
                    >
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="Takma adınız (ör. TenisSever)"
                        maxLength={24}
                        className="w-full h-10 px-3 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                      <textarea
                        rows={2}
                        value={replyMessage}
                        onChange={(e) => setReplyMessage(e.target.value)}
                        placeholder="Mesajınızı yazın (ör. Seviye 4'üm, saat 19:00 uygun)..."
                        maxLength={300}
                        className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                      {replyError && (
                        <p className="text-[11px] text-red-700">{replyError}</p>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyOpenPostId(null);
                            setReplyError(null);
                          }}
                          className="min-h-[38px] px-3 text-xs text-slate-600 cursor-pointer"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="submit"
                          disabled={replySubmitting}
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{replySubmitting ? 'Gönderiliyor...' : 'Gönder'}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Bottom Action Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {post.status !== 'closed' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!session || session.role !== 'resident') {
                              onOpenResidentLogin();
                              return;
                            }
                            setReplyError(null);
                            setReplyOpenPostId(isReplyOpen ? null : post.id);
                          }}
                          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isReplyOpen ? 'Formu Gizle' : 'Cevap Yaz'}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {post.isOwn && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(post)}
                          className="min-h-[40px] px-3 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl cursor-pointer"
                        >
                          {post.status === 'open' ? 'Partner Bulundu' : 'Tekrar Aç'}
                        </button>
                      )}
                      {(post.isOwn || session?.role === 'admin') && (
                        <button
                          type="button"
                          onClick={() => handleDeletePost(post.id)}
                          aria-label="İlanı sil"
                          className="min-w-[40px] min-h-[40px] flex items-center justify-center text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create Partner Listing Bottom Sheet / Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="partner-create-title"
        >
          <div className="w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <Users className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="partner-create-title" className="font-display text-base font-bold text-slate-900">
                    Oyun Arkadaşı İlanı Oluştur
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Daire numaranız gizli kalır, yalnızca takma adınız görünür
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Kapat"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePost} className="p-5 sm:p-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="partner-nickname" className="block text-xs font-semibold text-slate-700">
                  Takma Ad (Nickname)
                </label>
                <input
                  id="partner-nickname"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Örn: SiestaRaket, Kaya84"
                  maxLength={24}
                  className="w-full h-11 px-3.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  required
                />
              </div>

              {/* Format Boxes */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-slate-700">Oyun Türü</span>
                <div className="grid grid-cols-3 gap-2">
                  {FORMAT_OPTIONS.map((opt) => {
                    const Icon = opt.Icon;
                    const active = sessionFormat === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSessionFormat(opt.id)}
                        className={`min-h-[68px] p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1.5 text-xs font-bold transition-colors cursor-pointer ${
                          active
                            ? 'bg-emerald-700 border-emerald-700 text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" aria-hidden="true" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 1 to 7 Level Selector */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-slate-700">
                  Oyun Seviyesi (1 – 7)
                </span>
                <div className="grid grid-cols-7 gap-1.5">
                  {SKILL_LEVELS.map((lvl) => {
                    const active = skillLevel === lvl.level;
                    return (
                      <button
                        key={lvl.level}
                        type="button"
                        onClick={() => setSkillLevel(lvl.level)}
                        className={`min-h-[46px] rounded-xl border font-mono text-sm font-bold transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        {lvl.level}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-emerald-800 font-medium">
                  Seviye {skillLevel}: {getLevelInfo(skillLevel).shortLabel} —{' '}
                  <span className="text-slate-600 font-normal">
                    {getLevelInfo(skillLevel).description}
                  </span>
                </p>
              </div>

              {/* Date & Hour Range */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <label htmlFor="partner-date" className="block text-xs font-semibold text-slate-700">
                    Tarih
                  </label>
                  <select
                    id="partner-date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-xs font-medium"
                  >
                    {dateOptions.map((d) => (
                      <option key={d.dateStr} value={d.dateStr}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="partner-start" className="block text-xs font-semibold text-slate-700">
                    Başlangıç
                  </label>
                  <select
                    id="partner-start"
                    value={startHour}
                    onChange={(e) => handleStartHourChange(Number(e.target.value))}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-xs font-mono font-semibold"
                  >
                    {Array.from({ length: 16 }, (_, i) => 7 + i).map((h) => (
                      <option key={h} value={h}>
                        {pad2(h)}:00
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="partner-end" className="block text-xs font-semibold text-slate-700">
                    Bitiş
                  </label>
                  <select
                    id="partner-end"
                    value={endHour}
                    onChange={(e) => setEndHour(Number(e.target.value))}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-xs font-mono font-semibold"
                  >
                    {Array.from({ length: 23 - startHour }, (_, i) => startHour + 1 + i).map((h) => (
                      <option key={h} value={h}>
                        {pad2(h)}:00
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="partner-note" className="block text-xs font-semibold text-slate-700">
                  Not (Opsiyonel)
                </label>
                <textarea
                  id="partner-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Örn: Tekler maçı veya 1 saat tempolu ralli yapabiliriz..."
                  maxLength={240}
                  className="w-full p-3 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>İlanınız anında Oyun Arkadaşı Arayanlar panosunda görünür.</span>
              </div>

              {formError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="min-h-[48px] px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={submitting || nickname.trim().length < 2}
                  className="min-h-[48px] px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl cursor-pointer"
                >
                  {submitting ? 'Yayınlanıyor...' : 'İlanı Yayınla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
