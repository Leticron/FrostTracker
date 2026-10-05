import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, ErrorText, Field, PageTitle, Select } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';
import { useMe } from '../useMe.ts';

export function MembersPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const campaign = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  const members = useQuery(trpc.campaign.members.queryOptions({ campaignId }));
  const isHost = campaign.data?.role === 'host';
  const invites = useQuery({
    ...trpc.campaign.invites.queryOptions({ campaignId }),
    enabled: isHost,
  });
  const [role, setRole] = useState<'player' | 'host'>('player');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.campaign.members.queryKey({ campaignId }) }),
      qc.invalidateQueries({ queryKey: trpc.campaign.invites.queryKey({ campaignId }) }),
    ]);
  const createInvite = useMutation(
    trpc.campaign.createInvite.mutationOptions({
      onSuccess: async (r) => {
        setLink(`${window.location.origin}${r.joinPath}`);
        setCopied(false);
        await refresh();
      },
    }),
  );
  const setMemberRole = useMutation(trpc.campaign.setRole.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.campaign.removeMember.mutationOptions({ onSuccess: refresh }));
  const revoke = useMutation(trpc.campaign.revokeInvite.mutationOptions({ onSuccess: refresh }));

  return (
    <>
      <PageTitle>{t('members.title')}</PageTitle>
      <ErrorText error={members.error ?? setMemberRole.error ?? remove.error} />
      <ul className="mb-6 flex flex-col gap-2">
        {members.data?.map((m) => (
          <li key={m.userId}>
            <Card className="flex flex-wrap items-center gap-2">
              <span className="mr-auto font-medium">
                {m.displayName} <span className="text-sm text-slate-500">@{m.username}</span>
              </span>
              <Badge>{t(`campaigns.${m.role}`)}</Badge>
              {isHost && m.userId !== me?.id && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setMemberRole.mutate({
                        campaignId,
                        userId: m.userId,
                        role: m.role === 'host' ? 'player' : 'host',
                      })
                    }
                  >
                    {m.role === 'host' ? t('members.makePlayer') : t('members.makeHost')}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => remove.mutate({ campaignId, userId: m.userId })}
                  >
                    {t('members.remove')}
                  </Button>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {isHost && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('members.inviteRole')}>
              <Select value={role} onChange={(e) => setRole(e.target.value as 'player' | 'host')}>
                <option value="player">{t('campaigns.player')}</option>
                <option value="host">{t('campaigns.host')}</option>
              </Select>
            </Field>
            <Button
              onClick={() =>
                createInvite.mutate({ campaignId, role, expiresInDays: 14, maxUses: 1 })
              }
            >
              {t('members.invite')}
            </Button>
          </div>
          <ErrorText error={createInvite.error} />
          {link && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">{t('members.inviteCreated')}</p>
              <div className="flex gap-2">
                <code
                  data-testid="invite-link"
                  className="flex-1 overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800"
                >
                  {link}
                </code>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard?.writeText(link).then(() => setCopied(true))
                  }
                >
                  {copied ? t('members.copied') : t('members.copy')}
                </Button>
              </div>
            </div>
          )}
          {!!invites.data?.length && (
            <div>
              <h2 className="mb-2 font-medium">{t('members.openInvites')}</h2>
              <ul className="flex flex-col gap-2">
                {invites.data.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{t(`campaigns.${i.role}`)}</Badge>
                    <span>{t('members.uses', { uses: i.uses, max: i.maxUses })}</span>
                    <span className="mr-auto text-slate-500">
                      {t('members.expires', { date: new Date(i.expiresAt).toLocaleDateString() })}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => revoke.mutate({ campaignId, inviteId: i.id })}
                    >
                      {t('members.revoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
