import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';
import { api, ApiError, type AuthStatusResponse } from '../lib/api';
import type { AuthSession } from '../shared/types';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  authStatus: AuthStatusResponse | null;
  onAuthenticated: (session: AuthSession) => void;
  onGoToAdmin: () => void;
}

const LOGO_URL = '/assets/aistudio/image_457df46a.png';

export function AuthModal({
  open,
  onClose,
  authStatus,
  onAuthenticated,
  onGoToAdmin,
}: AuthModalProps) {
  const [apartmentNo, setApartmentNo] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apartments = authStatus?.apartments ?? [];

  useEffect(() => {
    if (apartments.length > 0 && !apartments.some((a) => a.apartmentNo === apartmentNo)) {
      setApartmentNo(apartments[0].apartmentNo);
    }
  }, [apartments, apartmentNo]);

  if (!open) return null;

  const selectedApt = apartments.find((a) => a.apartmentNo === apartmentNo);
  const anyPasswordsAssigned = apartments.some((a) => a.hasPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!apartmentNo.trim()) {
      setError('Lütfen daire numaranızı seçin veya girin.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.loginResident(apartmentNo.trim(), password, rememberMe);
      onAuthenticated({
        role: 'resident',
        apartmentNo: res.apartmentNo,
        token: res.token,
      });
      setPassword('');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Giriş yapılırken beklenmeyen bir hata oluştu.');
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
      aria-labelledby="resident-login-title"
    >
      <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="h-9 px-2 bg-white border border-slate-200 rounded-xl flex items-center justify-center shrink-0">
              <img src={LOGO_URL} alt="Soyak Siesta" className="h-5 w-auto object-contain" />
            </div>
            <div>
              <h2 id="resident-login-title" className="font-display text-sm sm:text-base font-bold text-slate-900">
                Daire Sakini Girişi
              </h2>
              <p className="text-[11px] text-slate-500">Şifreli Rezervasyon Oturumu</p>
            </div>
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

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          {apartments.length === 0 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-2.5">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                <span>Henüz kayıtlı daire eklenmemiş</span>
              </div>
              <p className="leading-relaxed">
                Site yönetimi henüz daire numaralarını ve şifrelerini tanımlamamış. Yönetici iseniz Yönetim sekmesinden daireleri ekleyebilirsiniz.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGoToAdmin();
                }}
                className="min-h-[40px] px-3.5 py-2 bg-amber-900 text-white font-semibold rounded-xl cursor-pointer"
              >
                Yönetim Paneline Geç
              </button>
            </div>
          ) : (
            !anyPasswordsAssigned && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-2">
                <p className="font-medium">Henüz hiçbir daireye şifre tahsis edilmemiş.</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onGoToAdmin();
                  }}
                  className="font-semibold text-amber-950 underline hover:no-underline cursor-pointer"
                >
                  Yönetim Panelini Aç
                </button>
              </div>
            )
          )}

          <div className="space-y-1.5">
            <label htmlFor="apt-select" className="block text-xs font-semibold text-slate-700">
              Blok / Daire Numarası
            </label>
            {apartments.length > 0 ? (
              <select
                id="apt-select"
                value={apartmentNo}
                onChange={(e) => {
                  setApartmentNo(e.target.value);
                  setError(null);
                }}
                className="w-full h-12 px-3.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                {apartments.map((apt) => (
                  <option key={apt.apartmentNo} value={apt.apartmentNo}>
                    {apt.residentLabel} {!apt.hasPassword ? '(Şifre atanmadı)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="apt-select"
                type="text"
                value={apartmentNo}
                onChange={(e) => setApartmentNo(e.target.value)}
                placeholder="Örn: B1-12 veya K2/4"
                className="w-full h-12 px-3.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                required
              />
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="apt-password" className="block text-xs font-semibold text-slate-700">
              Daire Şifresi
            </label>
            <div className="relative">
              <KeyRound
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="apt-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tahsis edilen şifreyi girin"
                autoComplete="current-password"
                className="w-full h-12 pl-10 pr-3.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
                required
              />
            </div>
            {selectedApt && !selectedApt.hasPassword && (
              <p className="text-xs text-amber-700">
                Seçili daireye henüz şifre atanmamıştır.
              </p>
            )}
          </div>

          <label className="flex items-center gap-3 min-h-[48px] px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50/70 hover:bg-slate-50 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700 shrink-0"
            />
            <div className="leading-snug">
              <span className="block text-sm font-semibold text-slate-800">Beni hatırla</span>
              <span className="block text-xs text-slate-500">
                Bu cihazda 30 gün boyunca tekrar şifre sorma
              </span>
            </div>
          </label>

          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={loading || !password.trim() || !apartmentNo.trim()}
              className="min-h-[48px] px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              {loading ? 'Doğrulanıyor...' : 'Giriş Yap'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
