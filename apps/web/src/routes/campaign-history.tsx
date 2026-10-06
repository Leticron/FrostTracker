import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorText, PageTitle } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';
import { describe } from './character.tsx';

/** Campaign-wide change history; hosts can revert any change group. */
export function CampaignHistoryPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(trpc.state.history.queryOptions({ campaignId }));
  const revert = useMutation(
    trpc.state.revert.mutationOptions({ onSettled: () => qc.invalidateQueries() }),
  );
  if (!q.data) return <ErrorText error={q.error} />;
  const groups = new Map<string, typeof q.data.entries>();
  for (const e of q.data.entries) groups.set(e.groupId, [...(groups.get(e.groupId) ?? []), e]);
  return (
    <>
      <PageTitle>{t('campaignHistory.title')}</PageTitle>
      <ErrorText error={revert.error} />
      {groups.size === 0 && <p className="text-slate-500">{t('history.empty')}</p>}
      <ul className="flex flex-col gap-2">
        {[...groups.entries()].map(([groupId, entries]) => {
          const first = entries[0]!;
          const reverted = entries.some((e) => e.revertedBy);
          const canRevert =
            q.data.canRevert &&
            !reverted &&
            !first.action.startsWith('revert_') &&
            !(first.entity === 'campaign' && first.action === 'create') &&
            entries.some((e) => e.entity !== 'note');
          return (
            <li key={groupId}>
              <Card
                className={`flex flex-wrap items-center gap-2 p-3 ${reverted ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {first.action.replaceAll('_', ' ')}
                    {reverted && (
                      <span className="ml-2 text-sm text-slate-500">({t('history.reverted')})</span>
                    )}
                  </div>
                  <div className="text-sm break-words text-slate-600 dark:text-slate-400">
                    {entries
                      .map((e) => describe(e.entity, e.before, e.after))
                      .filter(Boolean)
                      .slice(0, 8)
                      .join(' · ')}
                    {entries.length > 8 && ' …'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(first.at).toLocaleString()} ·{' '}
                    {t('history.by', { name: first.actorName ?? '—' })}
                  </div>
                </div>
                {canRevert && (
                  <Button
                    variant="secondary"
                    disabled={revert.isPending}
                    onClick={() => revert.mutate({ campaignId, groupId })}
                  >
                    {t('history.revert')}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
