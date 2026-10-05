import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme.ts';
import { trpc } from '../trpc.ts';
import { useMe } from '../useMe.ts';

export function AppShell() {
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
            aria-label={t('nav.theme')}
          >
            {t(`nav.theme${theme[0]!.toUpperCase()}${theme.slice(1)}` as 'nav.themeSystem')}
          </button>
          {me?.isSiteAdmin && (
            <Link
              to="/admin"
              className="min-h-12 content-center rounded-lg px-3 text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              {t('nav.admin')}
            </Link>
          )}
          <Link
            to="/profile"
            className="min-h-12 content-center rounded-lg px-3 text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            {me?.displayName ?? t('nav.profile')}
          </Link>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="min-h-12 rounded-lg px-3 text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            {t('nav.logout')}
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
