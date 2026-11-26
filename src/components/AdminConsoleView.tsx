import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  addDaysToDateStr,
  api,
  ApiError,
  formatHourRange,
  formatIstanbulDateTime,
  getTodayIstanbulDateStr,
} from '../lib/api';
import { exportArchiveToPdf } from '../lib/exportPdf';
import type { AdminOverviewResponse, AuthSession, SystemBackupPayload } from '../shared/types';

interface AdminConsoleViewProps {
  session: AuthSession | null;
  adminSetupNeeded: boolean;
  onAuthenticated: (session: AuthSession) => void;
  onRefreshAuthStatus: () => void;
  refreshTrigger?: number;
}

type AdminSubTab = 'apartments' | 'violations' | 'reservations' | 'stats';
type TimeRangePreset = 'today' | '7d' | '30d' | 'all' | 'custom';

function getDateRangeBounds(
  preset: TimeRangePreset,
  todayStr: string,
  customStart: string,
  customEnd: string
): { startDate: string | null; endDate: string | null } {
  if (preset === 'today') return { startDate: todayStr, endDate: todayStr };
  if (preset === '7d') return { startDate: addDaysToDateStr(todayStr, -6), endDate: null };
  if (preset === '30d') return { startDate: addDaysToDateStr(todayStr, -29), endDate: null };
  if (preset === 'custom') {
    return {
      startDate: customStart || null,
      endDate: customEnd || null,
    };
  }
  return { startDate: null, endDate: null };
}

function isDateStrInRange(
  dateStr: string,
  startDate: string | null,
  endDate: string | null
): boolean {
  if (startDate && dateStr < startDate) return false;
  if (endDate && dateStr > endDate) return false;
  return true;
}

export function AdminConsoleView({
  session,
  adminSetupNeeded,
  onAuthenticated,
  onRefreshAuthStatus,
  refreshTrigger = 0,
}: AdminConsoleViewProps) {
  // Login / First-run setup form state
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [adminRememberMe, setAdminRememberMe] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Admin workspace state
  const [subTab, setSubTab] = useState<AdminSubTab>('apartments');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Newly issued passcode highlight banner
  const [issuedList, setIssuedList] = useState<{ apartmentNo: string; passcode: string }[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);

  // Passcode visibility & copy tracking per apartment
  const [revealedPasscodes, setRevealedPasscodes] = useState<Record<string, boolean>>({});
  const [copiedApt, setCopiedApt] = useState<string | null>(null);
  const [confirmDeleteApt, setConfirmDeleteApt] = useState<string | null>(null);
  const [confirmCleanupUnassigned, setConfirmCleanupUnassigned] = useState(false);

  // Apartment search & add / reset
  const [aptSearch, setAptSearch] = useState('');
  const [newAptNo, setNewAptNo] = useState('');
  const [newAptPasscode, setNewAptPasscode] = useState('');
  const [customResetApt, setCustomResetApt] = useState<string | null>(null);
  const [customResetValue, setCustomResetValue] = useState('');

  // Violation logging & filtering
  const [violationApt, setViolationApt] = useState('');
  const [violationNote, setViolationNote] = useState('');
  const [violationFee, setViolationFee] = useState('');
  const [violationResId, setViolationResId] = useState<string>('');
  const [penaltyTypeFilter, setPenaltyTypeFilter] = useState<
    'all' | 'late_cancellation' | 'non_resident_violation'
  >('all');
  const [penaltyRange, setPenaltyRange] = useState<TimeRangePreset>('30d');
  const [penaltyCustomStart, setPenaltyCustomStart] = useState('');
  const [penaltyCustomEnd, setPenaltyCustomEnd] = useState('');

  // Reservations filter (status + time)
  const [resFilter, setResFilter] = useState<
    'all' | 'active' | 'cancelled_late' | 'cancelled_ontime'
  >('all');
  const [resRange, setResRange] = useState<TimeRangePreset>('all');
  const [resCustomStart, setResCustomStart] = useState('');
  const [resCustomEnd, setResCustomEnd] = useState('');

  // Statistics time filter
  const [statsRange, setStatsRange] = useState<TimeRangePreset>('all');
  const [statsCustomStart, setStatsCustomStart] = useState('');
  const [statsCustomEnd, setStatsCustomEnd] = useState('');

  // Archive PDF & Full JSON Backup / Restore state
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const [confirmCancelResId, setConfirmCancelResId] = useState<number | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [restoringJson, setRestoringJson] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{
    fileName: string;
    payload: SystemBackupPayload;
  } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const fetchOverview = useCallback(async () => {
    if (!session || session.role !== 'admin') return;
    setLoading(true);
    setActionError(null);
    try {
      const data = await api.getAdminOverview(session.token);
      setOverview(data);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Yönetim verileri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview, refreshTrigger]);

  const apartments = overview?.apartments ?? [];
  const todayStr = overview?.todayStr || getTodayIstanbulDateStr();

  useEffect(() => {
    if (apartments.length > 0 && !apartments.some((a) => a.apartmentNo === violationApt)) {
      setViolationApt(apartments[0].apartmentNo);
    } else if (apartments.length === 0 && violationApt !== '') {
      setViolationApt('');
    }
  }, [apartments, violationApt]);

  const allReservations = overview?.reservations ?? [];
  const allPenalties = overview?.penalties ?? [];

  const filteredReservations = useMemo(() => {
    const { startDate, endDate } = getDateRangeBounds(
      resRange,
      todayStr,
      resCustomStart,
      resCustomEnd
    );
    return allReservations.filter((r) => {
      if (resFilter !== 'all' && r.status !== resFilter) return false;
      return isDateStrInRange(r.dateStr, startDate, endDate);
    });
  }, [allReservations, resFilter, resRange, todayStr, resCustomStart, resCustomEnd]);

  const filteredPenalties = useMemo(() => {
    const { startDate, endDate } = getDateRangeBounds(
      penaltyRange,
      todayStr,
      penaltyCustomStart,
      penaltyCustomEnd
    );
    return allPenalties.filter((p) => {
      if (penaltyTypeFilter !== 'all' && p.type !== penaltyTypeFilter) return false;
      const pDateStr = getTodayIstanbulDateStr(p.createdAtMs);
      return isDateStrInRange(pDateStr, startDate, endDate);
    });
  }, [
    allPenalties,
    penaltyTypeFilter,
    penaltyRange,
    todayStr,
    penaltyCustomStart,
    penaltyCustomEnd,
  ]);

  // Statistics aggregation
  const stats = useMemo(() => {
    const { startDate, endDate } = getDateRangeBounds(
      statsRange,
      todayStr,
      statsCustomStart,
      statsCustomEnd
    );
    const scopedRes = allReservations.filter((r) =>
      isDateStrInRange(r.dateStr, startDate, endDate)
    );
    const scopedPenalties = allPenalties.filter((p) =>
      isDateStrInRange(getTodayIstanbulDateStr(p.createdAtMs), startDate, endDate)
    );

    const totalBookings = scopedRes.length;
    const activeOrCompleted = scopedRes.filter((r) => r.status === 'active').length;
    const cancelledOntime = scopedRes.filter((r) => r.status === 'cancelled_ontime').length;
    const cancelledLate = scopedRes.filter((r) => r.status === 'cancelled_late').length;
    const totalCancelled = cancelledOntime + cancelledLate;
    const cancelRatePct = totalBookings > 0 ? (totalCancelled / totalBookings) * 100 : 0;

    const matchCount = scopedRes.filter((r) => r.playType === 'match').length;
    const soloCount = scopedRes.filter((r) => r.playType === 'solo_training').length;
    const primeCount = scopedRes.filter((r) => r.hour >= 18 && r.hour <= 20).length;
    const primePct = totalBookings > 0 ? (primeCount / totalBookings) * 100 : 0;

    // Per-apartment stats
    const byAptMap = new Map<
      string,
      {
        apartmentNo: string;
        total: number;
        active: number;
        cancelled: number;
        lateCancelled: number;
      }
    >();
    for (const r of scopedRes) {
      const entry = byAptMap.get(r.apartmentNo) ?? {
        apartmentNo: r.apartmentNo,
        total: 0,
        active: 0,
        cancelled: 0,
        lateCancelled: 0,
      };
      entry.total += 1;
      if (r.status === 'active') entry.active += 1;
      if (r.status === 'cancelled_ontime') entry.cancelled += 1;
      if (r.status === 'cancelled_late') {
        entry.cancelled += 1;
        entry.lateCancelled += 1;
      }
      byAptMap.set(r.apartmentNo, entry);
    }

    const topBookers = Array.from(byAptMap.values())
      .sort((a, b) => b.total - a.total || b.active - a.active)
      .slice(0, 8);

    const topCancellers = Array.from(byAptMap.values())
      .filter((a) => a.cancelled > 0)
      .sort((a, b) => b.cancelled - a.cancelled || b.lateCancelled - a.lateCancelled)
      .slice(0, 8);

    // Per-hour stats (exclude cancelled or count all demand; count active demand + show total)
    const hourCounts = Array.from({ length: 16 }, (_, i) => {
      const hour = 7 + i;
      const allAtHour = scopedRes.filter((r) => r.hour === hour);
      const activeAtHour = allAtHour.filter((r) => r.status === 'active').length;
      return {
        hour,
        label: formatHourRange(hour),
        total: allAtHour.length,
        active: activeAtHour,
        isPrime: hour >= 18 && hour <= 20,
      };
    });
    const topHours = [...hourCounts]
      .filter((h) => h.total > 0)
      .sort((a, b) => b.active - a.active || b.total - a.total);

    const restrictedCount = apartments.filter((a) => Boolean(a.banUntilMs)).length;

    return {
      totalBookings,
      activeOrCompleted,
      cancelledOntime,
      cancelledLate,
      totalCancelled,
      cancelRatePct,
      matchCount,
      soloCount,
      primeCount,
      primePct,
      topBookers,
      topCancellers,
      topHours,
      penaltyCount: scopedPenalties.length,
      restrictedCount,
    };
  }, [
    allReservations,
    allPenalties,
    apartments,
    statsRange,
    todayStr,
    statsCustomStart,
    statsCustomEnd,
  ]);

  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (passcode.trim().length < 6) {
      setAuthError('Yönetici şifresi en az 6 karakter olmalıdır.');
      return;
    }
    if (passcode.trim() !== confirmPasscode.trim()) {
      setAuthError('Girilen şifreler eşleşmiyor.');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await api.setupAdmin(passcode.trim());
      setPasscode('');
      setConfirmPasscode('');
      onRefreshAuthStatus();
      onAuthenticated({ role: 'admin', token: res.token });
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Kurulum tamamlanamadı.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLoginAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await api.loginAdmin(passcode.trim(), adminRememberMe);
      setPasscode('');
      onAuthenticated({ role: 'admin', token: res.token });
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Giriş başarısız.');
    } finally {
      setAuthLoading(false);
    }
  };

  if (!session || session.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="space-y-2">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            {adminSetupNeeded ? 'Yönetici Şifresi Oluştur' : 'Yönetim Paneli Girişi'}
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            {adminSetupNeeded
              ? 'İlk kurulum için site yönetim şifresini belirleyin. Bu şifre şifre isteyen daireleri elle eklemek, unutulan şifreleri görüntülemek ve istatistikleri incelemek için kullanılacaktır.'
              : 'Daire numaralarını elle eklemek, unutulan daire şifrelerini görüntülemek, istatistikleri ve denetim kayıtlarını incelemek için yönetici şifresini girin.'}
          </p>
        </div>

        <form
          onSubmit={adminSetupNeeded ? handleSetupAdmin : handleLoginAdmin}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="admin-pass" className="block text-xs font-semibold text-slate-700">
              {adminSetupNeeded ? 'Yeni Yönetici Şifresi (en az 6 karakter)' : 'Yönetici Şifresi'}
            </label>
            <input
              id="admin-pass"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Yönetici şifresini girin"
              className="w-full h-12 px-3.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
              required
            />
          </div>

          {adminSetupNeeded && (
            <div className="space-y-1.5">
              <label htmlFor="admin-pass-confirm" className="block text-xs font-semibold text-slate-700">
                Şifreyi Onaylayın
              </label>
              <input
                id="admin-pass-confirm"
                type="password"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                placeholder="Şifreyi tekrar girin"
                className="w-full h-12 px-3.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                required
              />
            </div>
          )}

          {!adminSetupNeeded && (
            <label className="flex items-center gap-3 min-h-[48px] px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50/70 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={adminRememberMe}
                onChange={(e) => setAdminRememberMe(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 shrink-0"
              />
              <div className="leading-snug">
                <span className="block text-sm font-semibold text-slate-800">Beni hatırla</span>
                <span className="block text-xs text-slate-500">
                  Tarayıcı kapansa bile bu cihazda 7 gün oturumu açık tut
                </span>
              </div>
            </label>
          )}

          {authError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={authLoading}
            className="min-h-[48px] w-full py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
          >
            {authLoading
              ? 'İşleniyor...'
              : adminSetupNeeded
              ? 'Yönetici Şifresini Kaydet ve Giriş Yap'
              : 'Yönetim Paneline Gir'}
          </button>
        </form>
      </div>
    );
  }

  const filteredApartments = apartments.filter(
    (a) =>
      a.apartmentNo.toLowerCase().includes(aptSearch.trim().toLowerCase()) ||
      a.residentLabel.toLowerCase().includes(aptSearch.trim().toLowerCase())
  );
  const missingPasswordCount = apartments.filter((a) => !a.hasPassword).length;
  const selectedViolationApt = apartments.find((a) => a.apartmentNo === violationApt);
  const isRepeatViolation = (selectedViolationApt?.nonResidentViolations ?? 0) >= 1;

  const handleCleanupUnassigned = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.adminCleanupUnassigned(session.token);
      setConfirmCleanupUnassigned(false);
      setActionSuccess(
        res.deletedCount > 0
          ? `Şifresiz ${res.deletedCount} daire kaydı temizlendi.`
          : 'Temizlenecek şifresiz daire bulunmadı.'
      );
      onRefreshAuthStatus();
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Temizlik yapılamadı.');
    }
  };

  const handleSingleReset = async (apartmentNo: string, customPwd?: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.adminSetApartmentPassword(session.token, apartmentNo, customPwd);
      setIssuedList([{ apartmentNo: res.apartmentNo, passcode: res.issuedPasscode }]);
      setRevealedPasscodes((prev) => ({ ...prev, [apartmentNo]: true }));
      setCustomResetApt(null);
      setCustomResetValue('');
      setActionSuccess(`Daire ${apartmentNo} şifresi güncellendi.`);
      onRefreshAuthStatus();
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Şifre güncellenemedi.');
    }
  };

  const handleAddApartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.adminAddApartment(session.token, {
        apartmentNo: newAptNo.trim(),
        password: newAptPasscode.trim() || undefined,
      });
      setIssuedList([{ apartmentNo: res.apartmentNo, passcode: res.issuedPasscode }]);
      setRevealedPasscodes((prev) => ({ ...prev, [res.apartmentNo]: true }));
      setNewAptNo('');
      setNewAptPasscode('');
      setActionSuccess(`${res.residentLabel} eklendi ve şifresi oluşturuldu.`);
      onRefreshAuthStatus();
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Daire eklenemedi.');
    }
  };

  const handleDeleteApartment = async (apartmentNo: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.adminDeleteApartment(session.token, apartmentNo);
      setConfirmDeleteApt(null);
      setActionSuccess(`Daire ${apartmentNo} kaydı silindi.`);
      onRefreshAuthStatus();
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Daire silinemedi.');
    }
  };

  const handleLiftBan = async (apartmentNo: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.adminLiftBan(session.token, apartmentNo);
      setActionSuccess(`Daire ${apartmentNo} rezervasyon kısıtlaması kaldırıldı.`);
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Kısıtlama kaldırılamadı.');
    }
  };

  const handleLogViolation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!violationApt) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.adminLogViolation(session.token, {
        apartmentNo: violationApt,
        reservationId: violationResId ? Number(violationResId) : null,
        note: violationNote.trim() || undefined,
        feeAmount: isRepeatViolation && violationFee.trim() ? violationFee.trim() : undefined,
      });
      setViolationNote('');
      setViolationFee('');
      setViolationResId('');
      setActionSuccess(res.note);
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'İhlal kaydedilemedi.');
    }
  };

  const handleAdminCancelRes = async (resId: number) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.adminCancelReservation(session.token, resId);
      setConfirmCancelResId(null);
      setActionSuccess('Rezervasyon yönetici tarafından iptal edildi.');
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Rezervasyon iptal edilemedi.');
    }
  };

  const handleCopySingle = async (apartmentNo: string, passcodeValue: string) => {
    try {
      await navigator.clipboard.writeText(passcodeValue);
      setCopiedApt(apartmentNo);
      setTimeout(() => setCopiedApt((prev) => (prev === apartmentNo ? null : prev)), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleCopyIssued = async () => {
    const text = issuedList.map((i) => `Daire ${i.apartmentNo}: ${i.passcode}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Clipboard may be blocked
    }
  };

  const handleDownloadJsonBackup = async () => {
    setActionError(null);
    setActionSuccess(null);
    setExportingJson(true);
    try {
      const backup = await api.getAdminBackup(session.token);
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `soyak-siesta-yedek-${todayStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setActionSuccess(
        `Tam sistem yedeği (.json) indirildi (${backup.data.apartments.length} daire, ${backup.data.reservations.length} rezervasyon).`
      );
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'JSON yedeği indirilemedi.');
    } finally {
      setExportingJson(false);
    }
  };

  const handleDownloadPdfArchive = async () => {
    setActionError(null);
    setActionSuccess(null);
    setExportingPdf(true);
    try {
      const backup = await api.getAdminBackup(session.token);
      exportArchiveToPdf(backup, todayStr);
      setActionSuccess('Yönetim arşivi PDF olarak indirildi.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'PDF arşivi oluşturulamadı.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<SystemBackupPayload>;
      if (
        !parsed ||
        parsed.version !== 1 ||
        !parsed.data ||
        !Array.isArray(parsed.data.apartments) ||
        !Array.isArray(parsed.data.reservations)
      ) {
        setActionError('Seçilen dosya geçerli bir Soyak Siesta JSON yedek dosyası değil.');
        return;
      }
      setPendingRestore({
        fileName: file.name,
        payload: parsed as SystemBackupPayload,
      });
    } catch {
      setActionError('JSON yedek dosyası okunamadı.');
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    setActionError(null);
    setActionSuccess(null);
    setRestoringJson(true);
    try {
      const res = await api.restoreAdminBackup(session.token, pendingRestore.payload);
      setPendingRestore(null);
      setActionSuccess(
        `Yedek geri yüklendi: ${res.counts.apartments} daire, ${res.counts.reservations} rezervasyon, ${res.counts.penalties} yaptırım, ${res.counts.partnerPosts} oyun arkadaşı ilanı.`
      );
      onRefreshAuthStatus();
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Yedek geri yüklenemedi.');
    } finally {
      setRestoringJson(false);
    }
  };

  const renderTimeFilterBar = (
    value: TimeRangePreset,
    onChangePreset: (p: TimeRangePreset) => void,
    customStart: string,
    onChangeStart: (v: string) => void,
    customEnd: string,
    onChangeEnd: (v: string) => void
  ) => (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-slate-200 rounded-xl">
        {(
          [
            { id: 'today', label: 'Bugün' },
            { id: '7d', label: 'Son 7 Gün' },
            { id: '30d', label: 'Son 30 Gün' },
            { id: 'all', label: 'Tümü' },
            { id: 'custom', label: 'Tarih Seç' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChangePreset(item.id)}
            className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer ${
              value === item.id
                ? 'bg-emerald-700 text-white font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {value === 'custom' && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <input
            type="date"
            aria-label="Başlangıç tarihi"
            value={customStart}
            onChange={(e) => onChangeStart(e.target.value)}
            className="h-9 px-2.5 bg-white border border-slate-300 rounded-xl font-mono text-xs"
          />
          <span className="text-slate-400">–</span>
          <input
            type="date"
            aria-label="Bitiş tarihi"
            value={customEnd}
            onChange={(e) => onChangeEnd(e.target.value)}
            className="h-9 px-2.5 bg-white border border-slate-300 rounded-xl font-mono text-xs"
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
            Soyak Siesta Yönetim Paneli
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Şifre talep eden daireleri elle ekleyin, rezervasyon ve iptalleri filtreleyin, kullanım istatistiklerini izleyin.
          </p>
        </div>

        {/* Android Boxy Sub-Tab Switcher */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              { id: 'apartments', label: 'Daireler', Icon: Building2 },
              { id: 'reservations', label: 'Rezervasyonlar', Icon: CalendarDays },
              { id: 'violations', label: 'İhlal / İptaller', Icon: ShieldAlert },
              { id: 'stats', label: 'İstatistikler', Icon: BarChart3 },
            ] as const
          ).map((t) => {
            const Icon = t.Icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`min-h-[46px] px-3 py-2 rounded-2xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900">
          {actionSuccess}
        </div>
      )}

      {/* Newly issued passcodes highlight */}
      {issuedList.length > 0 && (
        <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-emerald-400">Tahsis Edilen Daire Şifresi</p>
              <p className="text-xs text-slate-300">
                Şifreyi kopyalayıp daire sakiniyle paylaşabilirsiniz. Listeden de her zaman görüntülenebilir.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyIssued}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl cursor-pointer"
              >
                {copiedAll ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedAll ? 'Kopyalandı' : 'Kopyala'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIssuedList([])}
                className="min-h-[40px] px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
            {issuedList.map((item) => (
              <div
                key={item.apartmentNo}
                className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-slate-300 font-semibold">{item.apartmentNo}</span>
                <span className="font-mono font-bold text-white">{item.passcode}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-tab 1: Apartments & Passwords */}
      {subTab === 'apartments' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Manual Add Apartment Form */}
            <form
              onSubmit={handleAddApartment}
              className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3"
            >
              <div className="space-y-0.5">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Şifre İsteyen Daire Ekle (Elle Tanımlama)
                </h2>
                <p className="text-xs text-slate-500">
                  Sitedeki 700 daire kalabalık oluşturmaması için yalnızca şifre talep eden daireler eklenir (ör. A7 12, B1-4).
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                <div className="flex-1 space-y-1">
                  <label htmlFor="new-apt-no" className="block text-xs font-semibold text-slate-700">
                    Blok / Daire No
                  </label>
                  <input
                    id="new-apt-no"
                    type="text"
                    value={newAptNo}
                    onChange={(e) => setNewAptNo(e.target.value)}
                    placeholder="Örn: A7 12"
                    className="w-full h-11 px-3.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label htmlFor="new-apt-pwd" className="block text-xs font-semibold text-slate-700">
                    Şifre (boşsa otomatik üretilir)
                  </label>
                  <input
                    id="new-apt-pwd"
                    type="text"
                    value={newAptPasscode}
                    onChange={(e) => setNewAptPasscode(e.target.value)}
                    placeholder="Opsiyonel özel şifre"
                    className="w-full h-11 px-3.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Daire Ekle</span>
                </button>
              </div>
            </form>

            {/* Directory Summary & Unassigned Cleanup */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">Aktif Kullanıcı Sayısı</p>
                <p className="text-xs text-slate-500">
                  Şifreli daire:{' '}
                  <strong className="font-mono text-slate-900">
                    {apartments.length - missingPasswordCount}
                  </strong>
                  {' · '}Şifresiz:{' '}
                  <strong className="font-mono text-slate-900">{missingPasswordCount}</strong>
                </p>
              </div>

              {missingPasswordCount > 0 ? (
                confirmCleanupUnassigned ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCleanupUnassigned}
                      className="min-h-[44px] flex-1 px-3 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-xl cursor-pointer"
                    >
                      {missingPasswordCount} Kaydı Sil
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmCleanupUnassigned(false)}
                      className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                    >
                      Vazgeç
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCleanupUnassigned(true)}
                    className="min-h-[44px] w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    <span>Şifresiz Kayıtları Temizle</span>
                  </button>
                )
              ) : (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 font-medium flex items-center gap-2">
                  <KeyRound className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <span>Listede yalnızca şifre tahsis edilen daireler bulunuyor.</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
              <div className="relative w-full sm:w-72">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={aptSearch}
                  onChange={(e) => setAptSearch(e.target.value)}
                  placeholder="Daire veya blok ara..."
                  className="w-full h-10 pl-9 pr-3 bg-white border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
              <span className="font-mono text-xs text-slate-500">
                {filteredApartments.length} daire listeleniyor
              </span>
            </div>

            {loading && apartments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">Yükleniyor...</div>
            ) : apartments.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                  <Building2 className="w-6 h-6" aria-hidden="true" />
                </div>
                <p className="text-sm font-bold text-slate-900">Henüz kayıtlı daire bulunmuyor</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Kort kullanmak isteyen dairelerin blok/daire numarasını (ör. A7 12) yukarıdaki formdan ekleyip şifre verebilirsiniz.
                </p>
              </div>
            ) : (
              <>
                {/* Mobile Android-style Boxy Cards */}
                <div className="md:hidden divide-y divide-slate-200">
                  {filteredApartments.map((apt) => {
                    const isRevealed = Boolean(revealedPasscodes[apt.apartmentNo]);
                    const hasVisiblePasscode = Boolean(apt.visiblePasscode);
                    return (
                      <div key={apt.apartmentNo} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-display text-sm font-bold text-slate-900">
                              {apt.residentLabel}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              15G Geç İptal:{' '}
                              <strong className="font-mono">{apt.lateCancelsLast15d}</strong>
                              {' · '}Sakini İhlali:{' '}
                              <strong className="font-mono">{apt.nonResidentViolations}</strong>
                            </p>
                          </div>
                          {apt.banUntilMs ? (
                            <span className="text-xs font-bold text-red-700">Kısıtlı</span>
                          ) : (
                            <span className="text-xs font-medium text-emerald-800">Normal</span>
                          )}
                        </div>

                        {/* Admin Passcode Box */}
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="block text-[10px] font-medium text-slate-500">
                              Daire Şifresi
                            </span>
                            {hasVisiblePasscode ? (
                              <span className="font-mono text-sm font-bold text-slate-900">
                                {isRevealed ? apt.visiblePasscode : '••••••••'}
                              </span>
                            ) : apt.hasPassword ? (
                              <span className="text-[11px] text-slate-500">
                                Eski kayıt (görmek için sıfırlayın)
                              </span>
                            ) : (
                              <span className="text-xs text-amber-700 font-medium">Atanmadı</span>
                            )}
                          </div>
                          {hasVisiblePasscode && apt.visiblePasscode && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedPasscodes((prev) => ({
                                    ...prev,
                                    [apt.apartmentNo]: !prev[apt.apartmentNo],
                                  }))
                                }
                                aria-label={isRevealed ? 'Şifreyi gizle' : 'Şifreyi göster'}
                                className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-700 cursor-pointer"
                              >
                                {isRevealed ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopySingle(apt.apartmentNo, apt.visiblePasscode!)}
                                aria-label="Şifreyi kopyala"
                                className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-700 cursor-pointer"
                              >
                                {copiedApt === apt.apartmentNo ? (
                                  <Check className="w-4 h-4 text-emerald-700" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        {customResetApt === apt.apartmentNo ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={customResetValue}
                              onChange={(e) => setCustomResetValue(e.target.value)}
                              placeholder="Yeni şifre (boş=otomatik)"
                              className="flex-1 h-10 px-3 border border-slate-300 rounded-xl text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleSingleReset(
                                  apt.apartmentNo,
                                  customResetValue.trim() || undefined
                                )
                              }
                              className="min-h-[40px] px-3 text-xs font-semibold text-white bg-emerald-700 rounded-xl cursor-pointer"
                            >
                              Kaydet
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomResetApt(null);
                                setCustomResetValue('');
                              }}
                              className="min-h-[40px] px-2.5 text-xs text-slate-600 cursor-pointer"
                            >
                              İptal
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setCustomResetApt(apt.apartmentNo)}
                              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-xl cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Şifre Değiştir</span>
                            </button>
                            {apt.banUntilMs && (
                              <button
                                type="button"
                                onClick={() => handleLiftBan(apt.apartmentNo)}
                                className="min-h-[40px] px-3 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl cursor-pointer"
                              >
                                Kısıtı Kaldır
                              </button>
                            )}
                            {confirmDeleteApt === apt.apartmentNo ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteApartment(apt.apartmentNo)}
                                  className="min-h-[40px] px-3 text-xs font-semibold text-white bg-red-700 rounded-xl cursor-pointer"
                                >
                                  Silmeyi Onayla
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteApt(null)}
                                  className="min-h-[40px] px-2.5 text-xs text-slate-600 cursor-pointer"
                                >
                                  Vazgeç
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteApt(apt.apartmentNo)}
                                aria-label="Daireyi sil"
                                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-red-700 bg-red-50 border border-red-200 rounded-xl ml-auto cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Daire / Blok</th>
                        <th className="px-5 py-3 font-medium">Daire Şifresi</th>
                        <th className="px-5 py-3 font-medium">15G Geç İptal</th>
                        <th className="px-5 py-3 font-medium">Sakini İhlali</th>
                        <th className="px-5 py-3 font-medium">Durum</th>
                        <th className="px-5 py-3 font-medium text-right">İşlemler</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredApartments.map((apt) => {
                        const isRevealed = Boolean(revealedPasscodes[apt.apartmentNo]);
                        const hasVisiblePasscode = Boolean(apt.visiblePasscode);
                        return (
                          <tr key={apt.apartmentNo} className="hover:bg-slate-50">
                            <td className="px-5 py-3.5 font-semibold text-slate-900 whitespace-nowrap">
                              {apt.residentLabel}
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              {hasVisiblePasscode && apt.visiblePasscode ? (
                                <div className="inline-flex items-center gap-2">
                                  <span className="font-mono font-bold text-slate-900 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                                    {isRevealed ? apt.visiblePasscode : '••••••••'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRevealedPasscodes((prev) => ({
                                        ...prev,
                                        [apt.apartmentNo]: !prev[apt.apartmentNo],
                                      }))
                                    }
                                    title={isRevealed ? 'Şifreyi gizle' : 'Şifreyi göster'}
                                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                                  >
                                    {isRevealed ? (
                                      <EyeOff className="w-3.5 h-3.5" />
                                    ) : (
                                      <Eye className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCopySingle(apt.apartmentNo, apt.visiblePasscode!)
                                    }
                                    title="Şifreyi kopyala"
                                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                                  >
                                    {copiedApt === apt.apartmentNo ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              ) : apt.hasPassword ? (
                                <span className="text-slate-500">Tanımlı (Görmek için sıfırlayın)</span>
                              ) : (
                                <span className="text-amber-700 font-medium">Atanmadı</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 font-mono text-slate-700">
                              {apt.lateCancelsLast15d}
                            </td>
                            <td className="px-5 py-3.5 font-mono text-slate-700">
                              {apt.nonResidentViolations}
                            </td>
                            <td className="px-5 py-3.5">
                              {apt.banUntilMs ? (
                                <div className="space-y-0.5">
                                  <span className="font-semibold text-red-700">Kısıtlı</span>
                                  <p className="text-[11px] text-slate-500 font-mono">
                                    {formatIstanbulDateTime(apt.banUntilMs)}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-slate-600">Normal</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                {customResetApt === apt.apartmentNo ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={customResetValue}
                                      onChange={(e) => setCustomResetValue(e.target.value)}
                                      placeholder="Boş=Otomatik"
                                      className="w-28 h-8 px-2 border border-slate-300 rounded-lg text-xs font-mono"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSingleReset(
                                          apt.apartmentNo,
                                          customResetValue.trim() || undefined
                                        )
                                      }
                                      className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
                                    >
                                      Kaydet
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCustomResetApt(null);
                                        setCustomResetValue('');
                                      }}
                                      className="px-2 py-1.5 text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer"
                                    >
                                      İptal
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setCustomResetApt(apt.apartmentNo)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
                                  >
                                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                                    <span>{apt.hasPassword ? 'Şifre Değiştir' : 'Şifre Ata'}</span>
                                  </button>
                                )}
                                {apt.banUntilMs && (
                                  <button
                                    type="button"
                                    onClick={() => handleLiftBan(apt.apartmentNo)}
                                    className="px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                                  >
                                    Kısıtı Kaldır
                                  </button>
                                )}
                                {confirmDeleteApt === apt.apartmentNo ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteApartment(apt.apartmentNo)}
                                      className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg cursor-pointer"
                                    >
                                      Silmeyi Onayla
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteApt(null)}
                                      className="px-2 py-1.5 text-[11px] text-slate-500 cursor-pointer"
                                    >
                                      Vazgeç
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteApt(apt.apartmentNo)}
                                    title="Daireyi sil"
                                    className="p-1.5 text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sub-tab 2: All Reservations with Time & Status Filters */}
      {subTab === 'reservations' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Site Geneli Rezervasyon Listesi
                </h2>
                <p className="text-[11px] text-slate-500 font-mono">
                  {filteredReservations.length} kayıt gösteriliyor
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-slate-200 rounded-xl">
                {(
                  [
                    { id: 'all', label: 'Tümü' },
                    { id: 'active', label: 'Aktif' },
                    { id: 'cancelled_ontime', label: 'Ücretsiz İptal' },
                    { id: 'cancelled_late', label: 'Geç İptaller' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setResFilter(f.id)}
                    className={`min-h-[34px] px-2.5 py-1 text-xs rounded-lg font-medium whitespace-nowrap cursor-pointer ${
                      resFilter === f.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {renderTimeFilterBar(
              resRange,
              setResRange,
              resCustomStart,
              setResCustomStart,
              resCustomEnd,
              setResCustomEnd
            )}
          </div>

          {filteredReservations.length === 0 ? (
            <div className="p-6 text-xs sm:text-sm text-slate-500">
              Seçili zaman aralığı ve duruma uygun rezervasyon bulunmamaktadır.
            </div>
          ) : (
            <>
              {/* Mobile Boxy Reservation Cards */}
              <div className="md:hidden divide-y divide-slate-200">
                {filteredReservations.map((r) => (
                  <div key={r.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-slate-900">
                        Daire {r.apartmentNo} ·{' '}
                        <span className="font-mono text-slate-500">#{r.id}</span>
                      </p>
                      <p className="font-mono text-xs text-slate-700">
                        {r.dateStr} · {formatHourRange(r.hour)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {r.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Maç'} ·{' '}
                        <span
                          className={
                            r.status === 'active'
                              ? 'text-emerald-800 font-semibold'
                              : r.status === 'cancelled_late'
                              ? 'text-amber-800 font-semibold'
                              : 'text-slate-500'
                          }
                        >
                          {r.status === 'active'
                            ? 'Aktif'
                            : r.status === 'cancelled_late'
                            ? 'Geç İptal'
                            : 'Ücretsiz İptal'}
                        </span>
                      </p>
                    </div>
                    {r.status === 'active' &&
                      (confirmCancelResId === r.id ? (
                        <div className="inline-flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAdminCancelRes(r.id)}
                            className="min-h-[40px] px-3 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-xl cursor-pointer"
                          >
                            İptali Onayla
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCancelResId(null)}
                            className="min-h-[40px] px-2.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                          >
                            Vazgeç
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmCancelResId(r.id)}
                          className="min-h-[40px] px-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl shrink-0 cursor-pointer"
                        >
                          İptal Et
                        </button>
                      ))}
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">ID</th>
                      <th className="px-5 py-3 font-medium">Daire</th>
                      <th className="px-5 py-3 font-medium">Tarih</th>
                      <th className="px-5 py-3 font-medium">Saat</th>
                      <th className="px-5 py-3 font-medium">Tür</th>
                      <th className="px-5 py-3 font-medium">Durum</th>
                      <th className="px-5 py-3 font-medium text-right">Yönetim İşlemi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredReservations.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-mono text-slate-500">#{r.id}</td>
                        <td className="px-5 py-3 font-semibold text-slate-900">
                          Daire {r.apartmentNo}
                        </td>
                        <td className="px-5 py-3 font-mono text-slate-700">{r.dateStr}</td>
                        <td className="px-5 py-3 font-mono text-slate-700">
                          {formatHourRange(r.hour)}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {r.playType === 'solo_training' ? 'Bireysel Antrenman' : 'Maç'}
                        </td>
                        <td className="px-5 py-3">
                          {r.status === 'active' ? (
                            <span className="font-medium text-emerald-800">Aktif</span>
                          ) : r.status === 'cancelled_late' ? (
                            <span className="font-medium text-amber-800">Geç İptal</span>
                          ) : (
                            <span className="text-slate-500">Ücretsiz İptal</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {r.status === 'active' &&
                            (confirmCancelResId === r.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleAdminCancelRes(r.id)}
                                  className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg cursor-pointer"
                                >
                                  İptali Onayla
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmCancelResId(null)}
                                  className="px-2 py-1.5 text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer"
                                >
                                  Vazgeç
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmCancelResId(r.id)}
                                className="px-2.5 py-1.5 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
                              >
                                İptal Et
                              </button>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sub-tab 3: Violations & Late Cancellations with Time Filter */}
      {subTab === 'violations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleLogViolation}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="font-display text-base font-bold text-slate-900">
                Daire Sakini İhlali Kaydet
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Kortu kullananlar arasında ilgili daire sakini bulunmadığının tespitinde ilk seferde uyarı, tekrarında 1 ay rezervasyon iptali ve yönetim inisiyatifinde ücretli ceza uygulanır.
              </p>
            </div>

            {apartments.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                İhlal kaydı girebilmek için önce &ldquo;Daireler&rdquo; sekmesinden en az bir daire eklemelisiniz.
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="v-apt" className="block text-xs font-semibold text-slate-700">
                    İlgili Daire
                  </label>
                  <select
                    id="v-apt"
                    value={violationApt}
                    onChange={(e) => setViolationApt(e.target.value)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-xs font-mono"
                  >
                    {apartments.map((a) => (
                      <option key={a.apartmentNo} value={a.apartmentNo}>
                        {a.residentLabel} (Önceki İhlal: {a.nonResidentViolations})
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  className={`p-3 rounded-xl border text-xs ${
                    isRepeatViolation
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  {isRepeatViolation
                    ? 'Bu dairenin daha önce ihlal kaydı bulunuyor. Kayıt sonrası 1 aylık rezervasyon hakkı iptal edilecek ve varsa ücretli ceza işlenecektir.'
                    : 'Bu dairenin ilk ihlal tespiti olacaktır. Sistem otomatik olarak Uyarı kaydı oluşturacaktır.'}
                </div>

                {isRepeatViolation && (
                  <div className="space-y-1.5">
                    <label htmlFor="v-fee" className="block text-xs font-semibold text-slate-700">
                      Ücretli Ceza Tutarı / Karar (Yönetim İnisiyatifi - Opsiyonel)
                    </label>
                    <input
                      id="v-fee"
                      type="text"
                      value={violationFee}
                      onChange={(e) => setViolationFee(e.target.value)}
                      placeholder="Örn: 500 TL aidata yansıtıldı"
                      className="w-full h-11 px-3 border border-slate-300 rounded-xl text-xs"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="v-res-id" className="block text-xs font-semibold text-slate-700">
                    İlgili Rezervasyon ID (Opsiyonel)
                  </label>
                  <input
                    id="v-res-id"
                    type="number"
                    value={violationResId}
                    onChange={(e) => setViolationResId(e.target.value)}
                    placeholder="Örn: 14"
                    className="w-full h-11 px-3 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="v-note" className="block text-xs font-semibold text-slate-700">
                    Denetim Notu
                  </label>
                  <textarea
                    id="v-note"
                    rows={3}
                    value={violationNote}
                    onChange={(e) => setViolationNote(e.target.value)}
                    placeholder="Tespit tarihi, saat ve saha görevlisi gözlemi..."
                    className="w-full p-3 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <button
                  type="submit"
                  className="min-h-[48px] w-full py-2.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-xl transition-colors cursor-pointer"
                >
                  {isRepeatViolation
                    ? 'Tekrar İhlal ve 1 Ay Kısıtlama Uygula'
                    : 'İlk Tespit Uyarısı Kaydet'}
                </button>
              </>
            )}
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  İhlal ve Geç İptal Kayıtları ({filteredPenalties.length})
                </h2>
                <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-xl">
                  {(
                    [
                      { id: 'all', label: 'Tümü' },
                      { id: 'late_cancellation', label: 'Geç İptal' },
                      { id: 'non_resident_violation', label: 'Sakini İhlali' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setPenaltyTypeFilter(f.id)}
                      className={`min-h-[32px] px-2.5 py-1 text-xs rounded-lg font-medium whitespace-nowrap cursor-pointer ${
                        penaltyTypeFilter === f.id
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {renderTimeFilterBar(
                penaltyRange,
                setPenaltyRange,
                penaltyCustomStart,
                setPenaltyCustomStart,
                penaltyCustomEnd,
                setPenaltyCustomEnd
              )}
            </div>

            {filteredPenalties.length === 0 ? (
              <div className="p-6 text-xs sm:text-sm text-slate-500">
                Seçili filtreye uygun ihlal veya geç iptal yaptırımı bulunmuyor.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredPenalties.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <ShieldAlert
                          className={`w-4 h-4 ${
                            p.action === 'warning' ? 'text-amber-600' : 'text-red-700'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-slate-900">Daire {p.apartmentNo}</span>
                        <span aria-hidden="true">·</span>
                        <span className={p.action === 'warning' ? 'text-amber-800' : 'text-red-800'}>
                          {p.type === 'late_cancellation'
                            ? 'Geç İptal'
                            : 'Daire Sakini İhlali'}{' '}
                          (
                          {p.action === 'warning'
                            ? 'Uyarı'
                            : p.action === 'ban_7d'
                            ? '1 Hafta Ban'
                            : '1 Ay Ban'}
                          )
                        </span>
                        {p.feeAmount && (
                          <span className="font-mono text-red-800">· Ceza: {p.feeAmount}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">{p.note}</p>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                      {formatIstanbulDateTime(p.createdAtMs)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-tab 4: Statistics Dashboard */}
      {subTab === 'stats' && (
        <div className="space-y-5">
          {/* Optional Time Selector Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                Kort Kullanım ve İptal İstatistikleri
              </h2>
              <p className="text-xs text-slate-500">
                Site genelinde toplanan rezervasyon, yoğun saat ve iptal verileri
              </p>
            </div>
            {renderTimeFilterBar(
              statsRange,
              setStatsRange,
              statsCustomStart,
              setStatsCustomStart,
              statsCustomEnd,
              setStatsCustomEnd
            )}
          </div>

          {/* 4 Boxy KPI Tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500">Toplam Rezervasyon</span>
              <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {stats.totalBookings}
              </p>
              <p className="text-[11px] text-slate-500">
                Aktif / Tamamlanan: <strong className="font-mono">{stats.activeOrCompleted}</strong>
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500">İptal Sıklığı / Oranı</span>
              <p className="font-mono text-2xl font-bold text-amber-800 tabular-nums">
                %{stats.cancelRatePct.toFixed(1)}
              </p>
              <p className="text-[11px] text-slate-500">
                {stats.totalCancelled} iptal ({stats.cancelledLate} geç · {stats.cancelledOntime}{' '}
                ücretsiz)
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500">Yoğun Saat (18–21) Payı</span>
              <p className="font-mono text-2xl font-bold text-emerald-800 tabular-nums">
                %{stats.primePct.toFixed(1)}
              </p>
              <p className="text-[11px] text-slate-500">
                {stats.primeCount} kayıt yoğun saatte
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500">Yaptırım & Kısıtlama</span>
              <p className="font-mono text-2xl font-bold text-red-700 tabular-nums">
                {stats.penaltyCount}
              </p>
              <p className="text-[11px] text-slate-500">
                Aktif kısıtlı daire: <strong className="font-mono">{stats.restrictedCount}</strong>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Booking Apartments */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  En Çok Rezervasyon Yapan Daireler
                </h3>
              </div>
              {stats.topBookers.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">
                  Seçili dönem için henüz rezervasyon verisi bulunmuyor.
                </div>
              ) : (
                <div className="p-5 space-y-3">
                  {stats.topBookers.map((item, idx) => {
                    const maxTotal = stats.topBookers[0]?.total || 1;
                    const widthPct = Math.round((item.total / maxTotal) * 100);
                    return (
                      <div key={item.apartmentNo} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900">
                            {idx + 1}. Daire {item.apartmentNo}
                          </span>
                          <span className="font-mono text-slate-700">
                            <strong>{item.total}</strong> kayıt ({item.active} aktif)
                          </span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-lg overflow-hidden">
                          <div
                            className="h-full bg-emerald-700 rounded-lg"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Most Frequently Used Hours */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  En Sık Kullanılan Saatler
                </h3>
              </div>
              {stats.topHours.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">
                  Seçili dönem için saat dağılımı verisi bulunmuyor.
                </div>
              ) : (
                <div className="p-5 space-y-3">
                  {stats.topHours.slice(0, 8).map((item) => {
                    const maxVal = stats.topHours[0]?.total || 1;
                    const widthPct = Math.round((item.total / maxVal) * 100);
                    return (
                      <div key={item.hour} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-slate-900">
                            {item.label}{' '}
                            {item.isPrime && (
                              <span className="font-sans font-medium text-amber-700">
                                · Yoğun
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-slate-700">
                            <strong>{item.total}</strong> rezervasyon ({item.active} gerçekleşen/aktif)
                          </span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-lg overflow-hidden">
                          <div
                            className={`h-full rounded-lg ${
                              item.isPrime ? 'bg-amber-600' : 'bg-slate-800'
                            }`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Top Cancelling Apartments & Cancellation Frequency */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  En Çok İptal Eden Daireler ve İptal Sıklığı
                </h3>
              </div>
              {stats.topCancellers.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">
                  Seçili dönem için iptal kaydı bulunmuyor.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {stats.topCancellers.map((item) => {
                    const aptCancelPct =
                      item.total > 0 ? Math.round((item.cancelled / item.total) * 100) : 0;
                    return (
                      <div
                        key={item.apartmentNo}
                        className="px-5 py-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">Daire {item.apartmentNo}</p>
                          <p className="text-[11px] text-slate-500">
                            {item.total} rezervasyonda {item.cancelled} iptal (%{aptCancelPct})
                          </p>
                        </div>
                        <div className="text-right font-mono">
                          <span className="font-bold text-red-700">{item.cancelled} iptal</span>
                          {item.lateCancelled > 0 && (
                            <p className="text-[11px] text-amber-800">
                              {item.lateCancelled} geç iptal
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Play Type Distribution */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Kullanım Türü Dağılımı
                </h3>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-[11px] text-slate-500">Eşli / Grup Maçı</span>
                    <p className="font-mono text-xl font-bold text-slate-900 mt-1">
                      {stats.matchCount}
                    </p>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-[11px] text-slate-500">Bireysel Antrenman</span>
                    <p className="font-mono text-xl font-bold text-emerald-800 mt-1">
                      {stats.soloCount}
                    </p>
                  </div>
                </div>
                {stats.totalBookings > 0 && (
                  <div className="space-y-1.5">
                    <div className="h-3 bg-slate-100 rounded-lg overflow-hidden flex">
                      <div
                        className="bg-slate-900 h-full"
                        style={{
                          width: `${Math.round((stats.matchCount / stats.totalBookings) * 100)}%`,
                        }}
                      />
                      <div
                        className="bg-emerald-700 h-full"
                        style={{
                          width: `${Math.round((stats.soloCount / stats.totalBookings) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono">
                      Maç: %{Math.round((stats.matchCount / stats.totalBookings) * 100)} · Antrenman: %
                      {Math.round((stats.soloCount / stats.totalBookings) * 100)}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Menu: Database Status, PDF Archive & JSON Backup/Restore */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setBackupMenuOpen((prev) => !prev)}
          aria-expanded={backupMenuOpen}
          className="w-full min-h-[52px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                overview?.databaseMode === 'postgres'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              <Database className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xs sm:text-sm font-bold text-slate-900 truncate">
                Arşiv (PDF) ve Sistem Yedeği (JSON)
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {overview?.databaseMode === 'postgres'
                  ? 'Veritabanı: Kalıcı PostgreSQL · Yedekleme ve arşiv araçları'
                  : 'Veritabanı: Geçici Yerel Depolama (SQLite) · Detaylar ve yedekleme için açın'}
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 shrink-0">
            <span>{backupMenuOpen ? 'Gizle' : 'Aç'}</span>
            {backupMenuOpen ? (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            )}
          </span>
        </button>

        {backupMenuOpen && (
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-3 border-t border-slate-200 bg-slate-50/60 space-y-4">
            <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-1">
              <p className="text-xs sm:text-sm font-bold text-slate-900">
                {overview?.databaseMode === 'postgres'
                  ? 'Kalıcı Veritabanı (PostgreSQL) Aktif'
                  : 'Geçici Yerel Depolama (SQLite) Aktif'}
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {overview?.databaseMode === 'postgres'
                  ? 'Daireler, şifreler ve rezervasyonlar harici PostgreSQL veritabanında tutulur; güncellemelerde korunur. Yine de düzenli yedek alabilirsiniz.'
                  : 'Sunucuda harici DATABASE_URL bağlı olmadığı için güncellemelerde veriler sıfırlanabilir. Render Environment ayarlarına PostgreSQL DATABASE_URL bağlayın veya aşağıdan JSON yedek alın.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdfArchive}
                disabled={exportingPdf}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl whitespace-nowrap cursor-pointer"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span>{exportingPdf ? 'Hazırlanıyor...' : 'Arşivi PDF İndir'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadJsonBackup}
                disabled={exportingJson}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 disabled:opacity-50 rounded-xl whitespace-nowrap cursor-pointer"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>{exportingJson ? 'İndiriliyor...' : 'Yedek JSON İndir'}</span>
              </button>

              <input
                ref={restoreInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleSelectRestoreFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                disabled={restoringJson}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-50 rounded-xl whitespace-nowrap cursor-pointer"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span>JSON Yedekten Yükle</span>
              </button>
            </div>

            {pendingRestore && (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-amber-950 space-y-0.5">
                  <p className="font-bold">
                    Geri Yükleme Onayı: <span className="font-mono">{pendingRestore.fileName}</span>
                  </p>
                  <p>
                    Bu işlem mevcut verilerin yerine yedekteki{' '}
                    <strong className="font-mono">
                      {pendingRestore.payload.data.apartments.length}
                    </strong>{' '}
                    daire,{' '}
                    <strong className="font-mono">
                      {pendingRestore.payload.data.reservations.length}
                    </strong>{' '}
                    rezervasyon ve{' '}
                    <strong className="font-mono">
                      {(pendingRestore.payload.data.penalties ?? []).length}
                    </strong>{' '}
                    yaptırım kaydını yükleyecektir.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleConfirmRestore}
                    disabled={restoringJson}
                    className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 rounded-xl cursor-pointer"
                  >
                    {restoringJson ? 'Yükleniyor...' : 'Onayla ve Geri Yükle'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRestore(null)}
                    disabled={restoringJson}
                    className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl cursor-pointer"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
