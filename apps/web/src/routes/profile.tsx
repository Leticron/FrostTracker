import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorText, Field, Input, PageTitle } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

export function ProfilePage() {
  const { t } = useTranslation();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({
      onSuccess: () => {
        setCurrent('');
        setNew('');
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate({ currentPassword, newPassword });
  };
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <PageTitle>{t('profile.title')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 className="font-medium">{t('profile.changePassword')}</h2>
          <Field label={t('profile.currentPassword')}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label={t('profile.newPassword')}>
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </Field>
          <ErrorText error={change.error} />
          {change.isSuccess && (
            <p className="text-sm text-green-700 dark:text-green-400">{t('profile.changed')}</p>
          )}
          <Button type="submit" disabled={change.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
