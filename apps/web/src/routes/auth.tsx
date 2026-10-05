import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorText, Field, Input } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-center text-3xl font-semibold">{t('app.name')}</h1>
      {children}
    </main>
  );
}

export function LoginForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: async () => {
        await qc.invalidateQueries();
        await onDone();
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('auth.username')}>
        <Input
          name="username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label={t('auth.password')}>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <ErrorText error={login.error} />
      <Button type="submit" disabled={login.isPending}>
        {t('auth.login')}
      </Button>
    </form>
  );
}

export function RegisterForm({
  inviteCode,
  onDone,
}: {
  inviteCode?: string;
  onDone: (campaignId: string | null) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const register = useMutation(
    trpc.auth.register.mutationOptions({
      onSuccess: async (r) => {
        await qc.invalidateQueries();
        await onDone(r.campaignId);
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate({ username, password, displayName: displayName || undefined, inviteCode });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('auth.username')}>
        <Input
          name="new-username"
          autoComplete="username"
          required
          minLength={3}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label={t('auth.displayName')}>
        <Input
          name="display-name"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field label={t('profile.newPassword')}>
        <Input
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <ErrorText error={register.error} />
      <Button type="submit" disabled={register.isPending}>
        {t('auth.register')}
      </Button>
    </form>
  );
}

export function LoginPage({ redirect }: { redirect?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useQuery(trpc.auth.me.queryOptions());
  return (
    <AuthLayout>
      <Card>
        <LoginForm
          onDone={() => navigate({ to: redirect && redirect.startsWith('/') ? redirect : '/' })}
        />
      </Card>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        {me.data?.registrationOpen ? (
          <Link to="/register" className="underline">
            {t('auth.registrationOpen')}
          </Link>
        ) : (
          t('auth.noAccount')
        )}
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <Card>
        <RegisterForm onDone={() => navigate({ to: '/' })} />
      </Card>
      <p className="text-center text-sm">
        <Link to="/login" className="underline">
          {t('auth.haveAccount')}
        </Link>
      </p>
    </AuthLayout>
  );
}

export function JoinPage({ code }: { code: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useQuery(trpc.auth.me.queryOptions());
  const accept = useMutation(
    trpc.campaign.acceptInvite.mutationOptions({
      onSuccess: (r) => navigate({ to: '/c/$campaignId', params: { campaignId: r.campaignId } }),
    }),
  );
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const goToCampaign = (campaignId: string | null) =>
    campaignId ? navigate({ to: '/c/$campaignId', params: { campaignId } }) : navigate({ to: '/' });

  if (me.isPending) return null;
  return (
    <AuthLayout>
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t('join.title')}</h2>
        <p>{t('join.intro')}</p>
        {me.data?.user ? (
          <>
            <ErrorText error={accept.error} />
            <Button onClick={() => accept.mutate({ code })} disabled={accept.isPending}>
              {t('join.accept')}
            </Button>
          </>
        ) : mode === 'register' ? (
          <>
            <RegisterForm inviteCode={code} onDone={goToCampaign} />
            <Button variant="ghost" onClick={() => setMode('login')}>
              {t('auth.haveAccount')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm">{t('join.loginFirst')}</p>
            <LoginForm onDone={() => undefined} />
            <Button variant="ghost" onClick={() => setMode('register')}>
              {t('auth.register')}
            </Button>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
