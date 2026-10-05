import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  PageTitle,
  Select,
} from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

export function PartyPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const list = useQuery(trpc.character.list.queryOptions({ campaignId }));
  const classes = useQuery(trpc.character.classes.queryOptions({ campaignId }));
  const retirements = useQuery(trpc.character.retirements.queryOptions({ campaignId }));
  const className = (key: string) => classes.data?.classes.find((c) => c.key === key)?.name ?? key;
  const noData = classes.error?.message.includes('no game data');

  const groups = [
    {
      key: 'active',
      title: t('party.active'),
      items: list.data?.filter((c) => c.status === 'active'),
    },
    {
      key: 'set_aside',
      title: t('party.setAside'),
      items: list.data?.filter((c) => c.status === 'set_aside'),
    },
    {
      key: 'history',
      title: t('party.history'),
      items: list.data?.filter((c) => !['active', 'set_aside'].includes(c.status)),
    },
  ];

  return (
    <>
      <PageTitle
        action={
          !noData && (
            <Link to="/c/$campaignId/characters/new" params={{ campaignId }}>
              <Button>{t('party.newCharacter')}</Button>
            </Link>
          )
        }
      >
        {t('party.title')}
      </PageTitle>
      {noData && (
        <Card className="mb-4">
          <p>{t('party.noData')}</p>
        </Card>
      )}
      <ErrorText error={list.error} />
      {list.data?.length === 0 && !noData && <p className="text-slate-500">{t('party.empty')}</p>}
      {groups.map(
        (g) =>
          !!g.items?.length && (
            <section key={g.key} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {g.title}
              </h2>
              <ul className="flex flex-col gap-2">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/c/$campaignId/characters/$characterId"
                      params={{ campaignId, characterId: c.id }}
                    >
                      <Card className="flex items-center gap-3 hover:border-sky-400">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-lg font-medium">{c.name}</div>
                          <div className="text-sm text-slate-500">
                            {className(c.classKey)} · {t('party.level', { level: c.level })} ·{' '}
                            {c.ownerName}
                          </div>
                        </div>
                        {c.status !== 'active' && <Badge>{t(`party.status_${c.status}`)}</Badge>}
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {!!retirements.data?.length && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {t('party.retirements')}
          </h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="p-3">{t('party.player')}</th>
                  <th className="p-3">{t('newCharacter.name')}</th>
                  <th className="p-3">{t('newCharacter.class')}</th>
                  <th className="p-3">Lvl</th>
                  <th className="p-3">{t('sheet.perks')}</th>
                  <th className="p-3">{t('sheet.masteries')}</th>
                </tr>
              </thead>
              <tbody>
                {retirements.data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="p-3">{r.playerName}</td>
                    <td className="p-3">{r.name}</td>
                    <td className="p-3">{className(r.classKey)}</td>
                    <td className="p-3">{r.level}</td>
                    <td className="p-3">{r.perkMarks.reduce((a, b) => a + b, 0)}</td>
                    <td className="p-3">{r.masteries.filter(Boolean).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </>
  );
}

export function NewCharacterPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const classes = useQuery(trpc.character.classes.queryOptions({ campaignId }));
  const campaign = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  const owners = useQuery(trpc.character.owners.queryOptions({ campaignId }));
  const [classKey, setClassKey] = useState('');
  const [name, setName] = useState('');
  const [startLevel, setStartLevel] = useState(1);
  const [owner, setOwner] = useState('');
  const create = useMutation(
    trpc.character.create.mutationOptions({
      onSuccess: async (r) => {
        await qc.invalidateQueries({ queryKey: trpc.character.pathKey() });
        await navigate({
          to: '/c/$campaignId/characters/$characterId',
          params: { campaignId, characterId: r.id },
        });
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ campaignId, classKey, name, startLevel, ownerUserId: owner || undefined });
  };
  const d = classes.data;
  return (
    <>
      <PageTitle>{t('newCharacter.title')}</PageTitle>
      <ErrorText error={classes.error} />
      {d && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('newCharacter.class')}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {d.classes
                .filter((c) => c.available)
                .map((c) => (
                  <label
                    key={c.key}
                    className={`flex min-h-14 items-center gap-3 rounded-xl border p-3 ${
                      classKey === c.key
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950'
                        : 'border-slate-200 dark:border-slate-800'
                    } ${c.taken ? 'opacity-50' : 'cursor-pointer'}`}
                  >
                    <input
                      type="radio"
                      name="class"
                      value={c.key}
                      disabled={c.taken}
                      checked={classKey === c.key}
                      onChange={() => setClassKey(c.key)}
                      className="h-5 w-5"
                    />
                    <span className="flex-1">{c.name}</span>
                    {c.taken && <Badge>{t('newCharacter.taken')}</Badge>}
                  </label>
                ))}
            </div>
          </fieldset>
          <Field label={t('newCharacter.name')}>
            <Input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {d.maxStartLevel > 1 && (
            <Field label={t('newCharacter.startLevel')}>
              <Select value={startLevel} onChange={(e) => setStartLevel(Number(e.target.value))}>
                {Array.from({ length: d.maxStartLevel }, (_, i) => i + 1).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {campaign.data?.role === 'host' && (
            <Field label={t('newCharacter.owner')}>
              <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">—</option>
                {owners.data?.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('newCharacter.startingGold', { gold: d.startingGold })}
          </p>
          <ErrorText error={create.error} />
          <Button type="submit" disabled={!classKey || create.isPending}>
            {t('newCharacter.create')}
          </Button>
        </form>
      )}
    </>
  );
}
