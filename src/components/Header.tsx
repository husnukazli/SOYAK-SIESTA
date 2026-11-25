import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  LogIn,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import type { AuthSession } from '../shared/types';

export type ActiveTab = 'schedule' | 'portal' | 'rules' | 'admin';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  session: AuthSession | null;
  onOpenResidentLogin: () => void;
  onLogout: () => void;
}

const LOGO_URL = '/assets/aistudio/image_457df46a.png';

export function Header({
  activeTab,
  onSelectTab,
  session,
  onOpenResidentLogin,
  onLogout,
}: HeaderProps) {
  const isResident = session?.role === 'resident';

  const navItems: {
    id: ActiveTab;
    label: string;
    mobileLabel: string;
    Icon: typeof CalendarDays;
  }[] = [
    { id: 'schedule', label: 'Kort Programı', mobileLabel: 'Program', Icon: CalendarDays },
    { id: 'portal', label: 'Rezervasyonlarım', mobileLabel: 'Kayıtlarım', Icon: ClipboardList },
    { id: 'rules', label: 'Kurallar', mobileLabel: 'Kurallar', Icon: BookOpen },
    ...(!isResident
      ? [{ id: 'admin' as ActiveTab, label: 'Yönetim', mobileLabel: 'Yönetim', Icon: ShieldCheck }]
      : []),
  ];

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-6">
          {/* Brand Logo Box */}
          <button
            type="button"
            onClick={() => onSelectTab('schedule')}
            className="flex items-center gap-2.5 min-h-[44px] py-1 px-1.5 -ml-1.5 rounded-xl hover:bg-slate-50 transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            aria-label="Soyak Siesta Tenis Ana Sayfa"
          >
            <div className="h-9 sm:h-10 px-2 py-1 bg-white border border-slate-200 rounded-xl flex items-center justify-center shadow-2xs">
              <img
                src={LOGO_URL}
                alt="Soyak Siesta"
                className="h-6 sm:h-7 w-auto object-contain"
              />
            </div>
            <span className="hidden sm:inline-block font-display text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap">
              Tenis Kortu
            </span>
          </button>

          {/* Desktop Navigation */}
          <nav
            aria-label="Ana menü"
            className="hidden md:flex items-center gap-2 text-sm font-medium"
          >
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.Icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${isActive ? 'text-emerald-700' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Primary Auth Action */}
          <div className="flex items-center shrink-0">
            {session ? (
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
              >
                <span className="max-w-[140px] truncate">
                  {session.role === 'admin'
                    ? 'Yönetici · Çıkış'
                    : `${session.apartmentNo} · Çıkış`}
                </span>
                <LogOut className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenResidentLogin}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
              >
                <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Daire Girişi</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Android-style Fixed Bottom Navigation Bar (Mobile only) */}
      <nav
        aria-label="Mobil alt menü"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 grid gap-1 ${
          navItems.length === 3 ? 'grid-cols-3' : 'grid-cols-4'
        }`}
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.Icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className="flex flex-col items-center justify-center min-h-[48px] py-1 px-1 rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              <div
                className={`w-12 h-7 rounded-xl flex items-center justify-center transition-colors ${
                  isActive
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
              </div>
              <span
                className={`text-[11px] mt-1 leading-none whitespace-nowrap ${
                  isActive ? 'font-bold text-emerald-900' : 'font-medium text-slate-600'
                }`}
              >
                {item.mobileLabel}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
