import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { api, ApiError, type AuthStatusResponse } from '../lib/api';
import type { AuthSession } from '../shared/types';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  authStatus: AuthStatusResponse | null;
  onAuthenticated: (session: AuthSession) => void;
  onGoToAdmin: () => void;
}

export function AuthModal({
  open,
  onClose,
  authStatus,
  onAuthenticated,
  onGoToAdmin,
}: AuthModalProps) {
  const [apartmentNo, setApartmentNo] = useState<string>('1');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const apartments = authStatus?.apartments ?? [];
  const selectedApt = apartments.find((a) => a.apartmentNo === apartmentNo);
  const anyPasswordsAssigned = apartments.some((a) => a.hasPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.loginResident(apartmentNo, password);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resident-login-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            <h2 id="resident-login-title" className="font-display text-base font-semibold text-slate-900">
              Daire Sakini Girişi
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <p className="text-sm text-slate-600 leading-relaxed">
            Kort rezervasyonu ve iptal işlemleri, daire numaranıza site yönetimi tarafından tahsis edilen şifre ile yapılır.
          </p>

          {!anyPasswordsAssigned && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-2">
              <p className="font-medium">Henüz hiçbir daireye şifre tahsis edilmemiş.</p>
              <p>
                Site yöneticisi iseniz Yönetim sekmesinden daire şifrelerini tanımlayabilirsiniz.
              </p>
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
          )}

          <div className="space-y-1.5">
            <label htmlFor="apt-select" className="block text-xs font-medium text-slate-700">
              Daire Numarası
            </label>
            {apartments.length > 0 ? (
              <select
                id="apt-select"
                value={apartmentNo}
                onChange={(e) => {
                  setApartmentNo(e.target.value);
                  setError(null);
                }}
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
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
                placeholder="Örn: 12"
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                required
              />
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="apt-password" className="block text-xs font-medium text-slate-700">
              Daire Şifresi
            </label>
            <input
              id="apt-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tahsis edilen şifreyi girin"
              autoComplete="current-password"
              className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              required
            />
            {selectedApt && !selectedApt.hasPassword && (
              <p className="text-xs text-amber-700">
                Seçili daireye henüz şifre atanmamıştır.
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {loading ? 'Doğrulanıyor...' : 'Giriş Yap'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
