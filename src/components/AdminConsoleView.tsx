import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  api,
  ApiError,
  formatHourRange,
  formatIstanbulDateTime,
} from '../lib/api';
import type { AdminOverviewResponse, AuthSession } from '../shared/types';

interface AdminConsoleViewProps {
  session: AuthSession | null;
  adminSetupNeeded: boolean;
  onAuthenticated: (session: AuthSession) => void;
  onRefreshAuthStatus: () => void;
  refreshTrigger?: number;
}

type AdminSubTab = 'apartments' | 'violations' | 'reservations';

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
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Admin workspace state
  const [subTab, setSubTab] = useState<AdminSubTab>('apartments');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Issued passcodes one-time banner
  const [issuedList, setIssuedList] = useState<{ apartmentNo: string; passcode: string }[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);

  // Apartment search & add / reset
  const [aptSearch, setAptSearch] = useState('');
  const [newAptNo, setNewAptNo] = useState('');
  const [newAptPasscode, setNewAptPasscode] = useState('');
  const [customResetApt, setCustomResetApt] = useState<string | null>(null);
  const [customResetValue, setCustomResetValue] = useState('');

  // Violation logging form
  const [violationApt, setViolationApt] = useState('1');
  const [violationNote, setViolationNote] = useState('');
  const [violationFee, setViolationFee] = useState('');
  const [violationResId, setViolationResId] = useState<string>('');

  // Reservations filter
  const [resFilter, setResFilter] = useState<'all' | 'active' | 'cancelled_late'>('all');

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
      const res = await api.loginAdmin(passcode.trim());
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
      <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-emerald-800">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs font-semibold">Site Yönetimi</span>
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            {adminSetupNeeded ? 'Yönetici Şifresi Oluştur' : 'Yönetim Paneli Girişi'}
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            {adminSetupNeeded
              ? 'İlk kurulum için site yönetim şifresini belirleyin. Bu şifre daire şifrelerini tahsis etmek ve denetim kayıtlarını girmek için kullanılacaktır.'
              : 'Daire şifrelerini yönetmek, denetim ihlallerini kaydetmek ve tüm kort rezervasyonlarını görmek için yönetici şifresini girin.'}
          </p>
        </div>

        <form
          onSubmit={adminSetupNeeded ? handleSetupAdmin : handleLoginAdmin}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="admin-pass" className="block text-xs font-medium text-slate-700">
              {adminSetupNeeded ? 'Yeni Yönetici Şifresi (en az 6 karakter)' : 'Yönetici Şifresi'}
            </label>
            <input
              id="admin-pass"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Yönetici şifresini girin"
              className="w-full h-11 px-3 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
              required
            />
          </div>

          {adminSetupNeeded && (
            <div className="space-y-1.5">
              <label htmlFor="admin-pass-confirm" className="block text-xs font-medium text-slate-700">
                Şifreyi Onaylayın
              </label>
              <input
                id="admin-pass-confirm"
                type="password"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                placeholder="Şifreyi tekrar girin"
                className="w-full h-11 px-3 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                required
              />
            </div>
          )}

          {authError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
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

  const apartments = overview?.apartments ?? [];
  const filteredApartments = apartments.filter((a) =>
    a.apartmentNo.toLowerCase().includes(aptSearch.trim().toLowerCase()) ||
    a.residentLabel.toLowerCase().includes(aptSearch.trim().toLowerCase())
  );
  const missingPasswordCount = apartments.filter((a) => !a.hasPassword).length;
  const selectedViolationApt = apartments.find((a) => a.apartmentNo === violationApt);
  const isRepeatViolation = (selectedViolationApt?.nonResidentViolations ?? 0) >= 1;

  const filteredReservations = (overview?.reservations ?? []).filter((r) => {
    if (resFilter === 'active') return r.status === 'active';
    if (resFilter === 'cancelled_late') return r.status === 'cancelled_late';
    return true;
  });

  const handleBatchGenerate = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.adminBatchPasswords(session.token);
      if (res.issued.length === 0) {
        setActionSuccess('Tüm dairelerin zaten tanımlanmış şifresi bulunuyor.');
      } else {
        setIssuedList(res.issued);
        setActionSuccess(`${res.issued.length} daire için yeni şifre oluşturuldu.`);
        onRefreshAuthStatus();
        await fetchOverview();
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Toplu şifre üretilemedi.');
    }
  };

  const handleSingleReset = async (apartmentNo: string, customPwd?: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.adminSetApartmentPassword(session.token, apartmentNo, customPwd);
      setIssuedList([{ apartmentNo: res.apartmentNo, passcode: res.issuedPasscode }]);
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
      setNewAptNo('');
      setNewAptPasscode('');
      setActionSuccess(`${res.residentLabel} eklendi ve şifresi oluşturuldu.`);
      onRefreshAuthStatus();
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Daire eklenemedi.');
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
      setActionSuccess('Rezervasyon yönetici tarafından iptal edildi.');
      await fetchOverview();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Rezervasyon iptal edilemedi.');
    }
  };

  const handleCopyIssued = async () => {
    const text = issuedList.map((i) => `Daire ${i.apartmentNo}: ${i.passcode}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Clipboard may be blocked in some contexts
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Site Kort Yönetim Paneli
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Daire şifrelerini tahsis edin, kullanım ihlallerini kaydedin ve aktif rezervasyonları denetleyin.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start">
          {(
            [
              { id: 'apartments', label: 'Daireler ve Şifreler' },
              { id: 'violations', label: 'Denetim ve İhlal' },
              { id: 'reservations', label: 'Tüm Rezervasyonlar' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === t.id
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
          {actionSuccess}
        </div>
      )}

      {/* One-time generated passcodes display */}
      {issuedList.length > 0 && (
        <div className="bg-slate-900 text-white rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-emerald-400">
                Tahsis Edilen Daire Şifreleri (Güvenlik nedeniyle yalnızca bir kez gösterilir)
              </p>
              <p className="text-xs text-slate-300">
                Bu şifreleri kopyalayıp ilgili daire sakinlerine iletebilirsiniz.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyIssued}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
              >
                {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAll ? 'Kopyalandı' : 'Tümünü Kopyala'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIssuedList([])}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 pt-1">
            {issuedList.map((item) => (
              <div
                key={item.apartmentNo}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-slate-300">D.{item.apartmentNo}</span>
                <span className="font-mono font-semibold text-white">{item.passcode}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-tab 1: Apartments & Passwords */}
      {subTab === 'apartments' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Add Apartment Form */}
            <form
              onSubmit={handleAddApartment}
              className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
            >
              <div className="flex-1 space-y-1">
                <label htmlFor="new-apt-no" className="block text-xs font-medium text-slate-700">
                  Yeni Daire No
                </label>
                <input
                  id="new-apt-no"
                  type="text"
                  value={newAptNo}
                  onChange={(e) => setNewAptNo(e.target.value)}
                  placeholder="Örn: 21 veya A-4"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  required
                />
              </div>
              <div className="flex-1 space-y-1">
                <label htmlFor="new-apt-pwd" className="block text-xs font-medium text-slate-700">
                  Şifre (boşsa otomatik üretilir)
                </label>
                <input
                  id="new-apt-pwd"
                  type="text"
                  value={newAptPasscode}
                  onChange={(e) => setNewAptPasscode(e.target.value)}
                  placeholder="Opsiyonel özel şifre"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Daire Ekle</span>
              </button>
            </form>

            {/* Batch Password Action */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-900">Toplu Şifre Tahsisi</p>
                <p className="text-xs text-slate-500">
                  Şifresi atanmamış daire sayısı:{' '}
                  <strong className="font-mono text-slate-900">{missingPasswordCount}</strong>
                </p>
              </div>
              <button
                type="button"
                disabled={missingPasswordCount === 0}
                onClick={handleBatchGenerate}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Eksik Şifreleri Üret</span>
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
              <div className="relative w-full sm:w-64">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={aptSearch}
                  onChange={(e) => setAptSearch(e.target.value)}
                  placeholder="Daire ara..."
                  className="w-full h-9 pl-8 pr-3 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
              <span className="font-mono text-xs text-slate-500">
                Toplam {filteredApartments.length} daire
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Daire</th>
                    <th className="px-5 py-3 font-medium">Şifre Durumu</th>
                    <th className="px-5 py-3 font-medium">15G Geç İptal</th>
                    <th className="px-5 py-3 font-medium">Sakini İhlali</th>
                    <th className="px-5 py-3 font-medium">Durum / Kısıtlama</th>
                    <th className="px-5 py-3 font-medium text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading && apartments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                        Yükleniyor...
                      </td>
                    </tr>
                  ) : (
                    filteredApartments.map((apt) => (
                      <tr key={apt.apartmentNo} className="hover:bg-slate-50">
                        <td className="px-5 py-3.5 font-semibold text-slate-900 whitespace-nowrap">
                          {apt.residentLabel}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {apt.hasPassword ? (
                            <span className="text-emerald-800 font-medium">Tanımlı</span>
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
                                  className="w-28 h-8 px-2 border border-slate-300 rounded text-xs font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSingleReset(
                                      apt.apartmentNo,
                                      customResetValue.trim() || undefined
                                    )
                                  }
                                  className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 rounded cursor-pointer"
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
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                                <span>{apt.hasPassword ? 'Şifre Sıfırla' : 'Şifre Ata'}</span>
                              </button>
                            )}
                            {apt.banUntilMs && (
                              <button
                                type="button"
                                onClick={() => handleLiftBan(apt.apartmentNo)}
                                className="px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                              >
                                Kısıtı Kaldır
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tab 2: Violations & Non-Resident Inspections */}
      {subTab === 'violations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleLogViolation}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Daire Sakini İhlali Kaydet
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Kortu kullananlar arasında ilgili daire sakini bulunmadığının tespitinde ilk seferde uyarı, tekrarında 1 ay rezervasyon iptali ve yönetim inisiyatifinde ücretli ceza uygulanır.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="v-apt" className="block text-xs font-medium text-slate-700">
                İlgili Daire
              </label>
              <select
                id="v-apt"
                value={violationApt}
                onChange={(e) => setViolationApt(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-xs font-mono"
              >
                {apartments.map((a) => (
                  <option key={a.apartmentNo} value={a.apartmentNo}>
                    {a.residentLabel} (Önceki İhlal: {a.nonResidentViolations})
                  </option>
                ))}
              </select>
            </div>

            <div
              className={`p-3 rounded-lg border text-xs ${
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
                <label htmlFor="v-fee" className="block text-xs font-medium text-slate-700">
                  Ücretli Ceza Tutarı / Karar (Yönetim İnisiyatifi - Opsiyonel)
                </label>
                <input
                  id="v-fee"
                  type="text"
                  value={violationFee}
                  onChange={(e) => setViolationFee(e.target.value)}
                  placeholder="Örn: 500 TL aidata yansıtıldı"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="v-res-id" className="block text-xs font-medium text-slate-700">
                İlgili Rezervasyon ID (Opsiyonel)
              </label>
              <input
                id="v-res-id"
                type="number"
                value={violationResId}
                onChange={(e) => setViolationResId(e.target.value)}
                placeholder="Örn: 14"
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="v-note" className="block text-xs font-medium text-slate-700">
                Denetim Notu
              </label>
              <textarea
                id="v-note"
                rows={3}
                value={violationNote}
                onChange={(e) => setViolationNote(e.target.value)}
                placeholder="Tespit tarihi, saat ve saha görevlisi gözlemi..."
                className="w-full p-3 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors cursor-pointer"
            >
              {isRepeatViolation ? 'Tekrar İhlal ve 1 Ay Kısıtlama Uygula' : 'İlk Tespit Uyarısı Kaydet'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Tüm İhlal ve Geç İptal Kayıtları
              </h2>
            </div>
            {(overview?.penalties ?? []).length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                Henüz kayıtlı ihlal veya geç iptal yaptırımı bulunmuyor.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {(overview?.penalties ?? []).map((p) => (
                  <div key={p.id} className="px-6 py-4 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <ShieldAlert
                          className={`w-3.5 h-3.5 ${
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
                          ({p.action === 'warning' ? 'Uyarı' : p.action === 'ban_7d' ? '1 Hafta Ban' : '1 Ay Ban'})
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

      {/* Sub-tab 3: All Reservations */}
      {subTab === 'reservations' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Site Geneli Rezervasyon Listesi
            </h2>
            <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
              {(
                [
                  { id: 'all', label: 'Tümü' },
                  { id: 'active', label: 'Aktif' },
                  { id: 'cancelled_late', label: 'Geç İptaller' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setResFilter(f.id)}
                  className={`px-2.5 py-1 text-xs rounded font-medium cursor-pointer ${
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

          {filteredReservations.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              Seçili filtreye uygun rezervasyon bulunmamaktadır.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                          <span className="text-slate-500">İptal</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {r.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => handleAdminCancelRes(r.id)}
                            className="px-2.5 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded cursor-pointer"
                          >
                            İptal Et
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
