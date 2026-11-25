import { LogOut } from 'lucide-react';
import type { AuthSession } from '../shared/types';

export type ActiveTab = 'schedule' | 'portal' | 'rules' | 'admin';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  session: AuthSession | null;
  onOpenResidentLogin: () => void;
  onLogout: () => void;
}

export function Header({
  activeTab,
  onSelectTab,
  session,
  onOpenResidentLogin,
  onLogout,
}: HeaderProps) {
  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'schedule', label: 'Kort Programı' },
    { id: 'portal', label: 'Rezervasyonlarım' },
    { id: 'rules', label: 'Kurallar' },
    { id: 'admin', label: 'Yönetim' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('schedule')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded-sm"
        >
          Soyak Siesta Tenis
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Ana menü"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                  isActive
                    ? 'border-emerald-700 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center shrink-0">
          {session ? (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              <span>
                {session.role === 'admin'
                  ? 'Yönetici · Çıkış'
                  : `Daire ${session.apartmentNo} · Çıkış`}
              </span>
              <LogOut className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenResidentLogin}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
            >
              Daire Girişi
            </button>
          )}
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav
        aria-label="Mobil menü"
        className="md:hidden flex items-center justify-between px-4 border-t border-slate-100 bg-white overflow-x-auto"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`py-2.5 px-2 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'border-emerald-700 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
