import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme.ts';
import { trpc } from '../trpc.ts';
import { useMe } from '../useMe.ts';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** The PWA keeps only the app shell offline; data needs the server (decision P2-5). */
function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

export function AppShell() {
  const online = useOnline();
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const logout = useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: async () => {
        qc.clear();
        await navigate({ to: '/login' });
      },
    }),
  );
  const cycleTheme = () => {
    const next: ThemeChoice = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    setThemeChoice(next);
  };

  const themeLabel = t(`nav.theme${theme[0]!.toUpperCase()}${theme.slice(1)}` as 'nav.themeSystem');
  const linkClass =
    'flex min-h-12 items-center rounded-lg px-3 text-sm hover:bg-slate-200 dark:hover:bg-slate-800';
  const accountLinks = (
    <>
      {me?.isSiteAdmin && (
        <Link to="/admin" className={linkClass}>
          {t('nav.admin')}
        </Link>
      )}
      <Link to="/profile" className={linkClass}>
        {me?.displayName ?? t('nav.profile')}
      </Link>
      <button type="button" onClick={() => logout.mutate()} className={`${linkClass} text-left`}>
        {t('nav.logout')}
      </button>
    </>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <Link to="/" className="mr-auto text-lg font-semibold">
            {t('app.name')}
          </Link>
          <button
            type="button"
            onClick={cycleTheme}
            className="min-h-12 rounded-lg px-3 text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
            aria-label={`${t('nav.theme')}: ${themeLabel}`}
            title={`${t('nav.theme')}: ${themeLabel}`}
          >
            <span aria-hidden className="text-lg">
              {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
            </span>
          </button>
          {/* Phones: account links in a menu; wider screens: inline. */}
          <details className="relative sm:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center rounded-lg px-3 text-sm hover:bg-slate-200 dark:hover:bg-slate-800">
              ☰ <span className="sr-only">{t('nav.menu')}</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 flex w-48 flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
              {accountLinks}
            </div>
          </details>
          <div className="hidden items-center sm:flex">{accountLinks}</div>
        </div>
      </header>
      {!online && (
        <p
          role="status"
          className="sticky top-14 z-20 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {t('nav.offline')}
        </p>
      )}
      <Outlet />
    </div>
  );
}
