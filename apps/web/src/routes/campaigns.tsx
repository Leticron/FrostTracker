import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, ErrorText, Field, Input, PageTitle } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

export function CampaignListPage() {
  const { t } = useTranslation();
  const list = useQuery(trpc.campaign.list.queryOptions());
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageTitle
        action={
          <Link to="/campaigns/new">
            <Button>{t('campaigns.new')}</Button>
          </Link>
        }
      >
        {t('campaigns.title')}
      </PageTitle>
      <ErrorText error={list.error} />
      {list.data?.length === 0 && (
        <Card>
          <p className="text-slate-600 dark:text-slate-400">{t('campaigns.empty')}</p>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {list.data?.map((c) => (
          <li key={c.id}>
            <Link to="/c/$campaignId" params={{ campaignId: c.id }} className="block">
              <Card className="flex items-center justify-between gap-2 hover:border-sky-400">
                <div>
                  <div className="text-lg font-medium">{c.name}</div>
                  {c.partyName && <div className="text-sm text-slate-500">{c.partyName}</div>}
                </div>
                <Badge>{t(`campaigns.${c.role}`)}</Badge>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function NewCampaignPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [partyName, setPartyName] = useState('');
  const create = useMutation(
    trpc.campaign.create.mutationOptions({
      onSuccess: async (r) => {
        await qc.invalidateQueries({ queryKey: trpc.campaign.list.queryKey() });
        await navigate({ to: '/c/$campaignId', params: { campaignId: r.id } });
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name, partyName: partyName || undefined });
  };
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <PageTitle>{t('campaigns.new')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t('campaigns.name')}>
            <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('campaigns.partyName')}>
            <Input
              maxLength={80}
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
            />
          </Field>
          <ErrorText error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            {t('common.create')}
          </Button>
        </form>
      </Card>
    </main>
  );
}

const tabs = [
  { to: '/c/$campaignId', key: 'dashboard', exact: true },
  { to: '/c/$campaignId/scenarios', key: 'scenarios' },
  { to: '/c/$campaignId/map', key: 'map' },
  { to: '/c/$campaignId/sessions', key: 'sessions' },
  { to: '/c/$campaignId/party', key: 'party' },
  { to: '/c/$campaignId/outpost', key: 'outpost' },
  { to: '/c/$campaignId/members', key: 'members' },
  { to: '/c/$campaignId/settings', key: 'settings' },
  { to: '/c/$campaignId/history', key: 'audit' },
] as const;

export function CampaignLayout({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const q = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  if (q.error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <ErrorText error={q.error} />
      </main>
    );
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col md:flex-row">
      <nav
        aria-label={q.data?.campaign.name}
        className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950 md:static md:w-52 md:shrink-0 md:flex-col md:border-0 md:bg-transparent md:p-4 md:dark:bg-transparent"
      >
        <div className="hidden px-3 pb-3 md:block">
          <div className="font-semibold">{q.data?.campaign.name}</div>
          {q.data && <Badge>{t(`campaigns.${q.data.role}`)}</Badge>}
        </div>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            params={{ campaignId }}
            activeOptions={{ exact: 'exact' in tab }}
            className="flex min-h-14 min-w-20 flex-1 items-center justify-center px-3 text-sm whitespace-nowrap text-slate-600 md:min-h-12 md:flex-none md:justify-start md:rounded-lg dark:text-slate-300"
            activeProps={{
              className:
                'font-semibold text-sky-600 dark:text-sky-400 md:bg-sky-50 md:dark:bg-slate-900',
            }}
          >
            {t(`campaign.${tab.key}`)}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-6 pb-24 md:pb-6">
        <Outlet />
      </main>
    </div>
  );
}
