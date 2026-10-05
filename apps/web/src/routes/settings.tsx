import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, ErrorText, Field, Input, PageTitle } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

export function SettingsPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const campaign = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  const dataSets = useQuery(trpc.admin.dataSets.queryOptions());
  const classes = useQuery(trpc.campaign.classUnlocks.queryOptions({ campaignId }));
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.campaign.pathKey() }),
      qc.invalidateQueries({ queryKey: trpc.character.pathKey() }),
    ]);
  const setDataSet = useMutation(trpc.campaign.setDataSet.mutationOptions({ onSettled: refresh }));
  const setUnlocked = useMutation(
    trpc.campaign.setClassUnlocked.mutationOptions({ onSettled: refresh }),
  );
  const isHost = campaign.data?.role === 'host';
  const current = campaign.data?.dataSet;

  return (
    <>
      <PageTitle>{t('settings.title')}</PageTitle>
      <ErrorText error={setDataSet.error ?? setUnlocked.error} />
      <section className="mb-6">
        <h2 className="mb-2 font-medium">{t('settings.dataSet')}</h2>
        <Card className="flex flex-col gap-2">
          <p>{current ? `${current.name} (${current.version})` : t('settings.noDataSet')}</p>
          {isHost &&
            dataSets.data
              ?.filter((d) => d.id !== current?.id)
              .map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-slate-500">
                    {d.name} ({d.version}) · {new Date(d.importedAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => setDataSet.mutate({ campaignId, dataSetId: d.id })}
                  >
                    {t('settings.useDataSet')}
                  </Button>
                </div>
              ))}
        </Card>
      </section>
      {!!classes.data?.length && (
        <section>
          <h2 className="mb-2 font-medium">{t('settings.classes')}</h2>
          <ul className="flex flex-col gap-2">
            {classes.data.map((c) => (
              <li key={c.key}>
                <Card className="flex flex-wrap items-center gap-2 p-3">
                  <span className="flex-1">{c.name}</span>
                  {c.starting && <Badge>{t('settings.starting')}</Badge>}
                  {c.unlocked && <Badge>{t('settings.unlocked')}</Badge>}
                  {isHost && !c.starting && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setUnlocked.mutate({ campaignId, classKey: c.key, unlocked: !c.unlocked })
                      }
                    >
                      {c.unlocked ? t('settings.lock') : t('settings.unlock')}
                    </Button>
                  )}
                  {isHost && (
                    <Link
                      to="/c/$campaignId/settings/classes/$classKey"
                      params={{ campaignId, classKey: c.key }}
                    >
                      <Button variant="ghost">{t('settings.editClass')}</Button>
                    </Link>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

interface PerkRow {
  text: string;
  boxes: number;
  linked: boolean;
}

export function ClassEditorPage({
  campaignId,
  classKey,
}: {
  campaignId: string;
  classKey: string;
}) {
  const { t } = useTranslation();
  const campaign = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  const dataSetId = campaign.data?.dataSet?.id;
  const cls = useQuery({
    ...trpc.admin.classDef.queryOptions({ dataSetId: dataSetId ?? '', key: classKey }),
    enabled: !!dataSetId,
  });
  return (
    <>
      <PageTitle>{t('classEditor.title')}</PageTitle>
      <ErrorText error={cls.error} />
      {cls.data && dataSetId && (
        <ClassForm key={JSON.stringify(cls.data)} dataSetId={dataSetId} initial={cls.data} />
      )}
    </>
  );
}

function ClassForm({
  dataSetId,
  initial,
}: {
  dataSetId: string;
  initial: {
    key: string;
    name: string;
    starting: boolean;
    perks: { text: string; boxes: number; linked?: boolean }[];
    masteries: string[];
    maxHpByLevel: number[] | null;
    handSize: number | null;
  };
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [starting, setStarting] = useState(initial.starting);
  const [perks, setPerks] = useState<PerkRow[]>(
    initial.perks.map((p) => ({ ...p, linked: p.linked ?? false })),
  );
  const [masteries, setMasteries] = useState<string[]>(initial.masteries);
  const [hp, setHp] = useState(initial.maxHpByLevel?.join(', ') ?? '');
  const [hand, setHand] = useState(initial.handSize?.toString() ?? '');
  const save = useMutation(
    trpc.admin.updateClass.mutationOptions({
      onSettled: () => qc.invalidateQueries({ queryKey: trpc.admin.pathKey() }),
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const maxHp = hp
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);
    save.mutate({
      dataSetId,
      key: initial.key,
      name,
      starting,
      perks: perks.filter((p) => p.text.trim()),
      masteries: masteries.filter((m) => m.trim()),
      maxHpByLevel: maxHp.length && maxHp.every((n) => Number.isInteger(n) && n > 0) ? maxHp : null,
      handSize: hand ? Number(hand) : null,
    });
  };
  const updatePerk = (i: number, patch: Partial<PerkRow>) =>
    setPerks((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <>
      <ErrorText error={save.error} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('classEditor.name')}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={starting}
            onChange={(e) => setStarting(e.target.checked)}
          />
          {t('classEditor.starting')}
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('classEditor.perks')}</legend>
          {perks.map((p, i) => (
            <Card key={i} className="flex flex-wrap items-end gap-2 p-3">
              <div className="min-w-48 flex-1">
                <Field label={t('classEditor.perkText')}>
                  <Input value={p.text} onChange={(e) => updatePerk(i, { text: e.target.value })} />
                </Field>
              </div>
              <Field label={t('classEditor.boxes')}>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  className="w-20"
                  value={p.boxes}
                  onChange={(e) =>
                    updatePerk(i, { boxes: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </Field>
              <label className="flex min-h-12 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={p.linked}
                  onChange={(e) => updatePerk(i, { linked: e.target.checked })}
                />
                {t('classEditor.linked')}
              </label>
              <Button
                variant="ghost"
                onClick={() => setPerks((ps) => ps.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </Card>
          ))}
          <Button
            variant="secondary"
            onClick={() => setPerks((ps) => [...ps, { text: '', boxes: 1, linked: false }])}
          >
            {t('classEditor.addPerk')}
          </Button>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('classEditor.masteries')}</legend>
          {masteries.map((m, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1">
                <Input
                  aria-label={`${t('classEditor.masteries')} ${i + 1}`}
                  value={m}
                  onChange={(e) =>
                    setMasteries((ms) => ms.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
              </div>
              <Button
                variant="ghost"
                onClick={() => setMasteries((ms) => ms.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setMasteries((ms) => [...ms, ''])}>
            {t('classEditor.addMastery')}
          </Button>
        </fieldset>
        <Field label={t('classEditor.maxHp')}>
          <Input value={hp} onChange={(e) => setHp(e.target.value)} placeholder="8, 9, 11, …" />
        </Field>
        <Field label={t('classEditor.handSize')}>
          <Input
            inputMode="numeric"
            className="w-28"
            value={hand}
            onChange={(e) => setHand(e.target.value)}
          />
        </Field>
        {save.isSuccess && (
          <p className="text-sm text-green-700 dark:text-green-400">{t('classEditor.saved')}</p>
        )}
        <Button type="submit" disabled={save.isPending || !dataSetId}>
          {t('common.save')}
        </Button>
      </form>
    </>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const check = useQuery(trpc.admin.seedCheck.queryOptions());
  const sets = useQuery(trpc.admin.dataSets.queryOptions());
  const imp = useMutation(
    trpc.admin.seedImport.mutationOptions({
      onSettled: () => qc.invalidateQueries({ queryKey: trpc.admin.pathKey() }),
    }),
  );
  const d = check.data;
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageTitle>{t('admin.title')}</PageTitle>
      <section className="mb-6">
        <h2 className="mb-2 font-medium">{t('admin.seed')}</h2>
        <Card className="flex flex-col gap-3">
          {d && <p className="text-sm text-slate-500">{t('admin.seedDir', { dir: d.dir })}</p>}
          {d?.ok === false && <ErrorText error={d.error} />}
          {d?.ok && (
            <p>
              {t('admin.seedOk', {
                name: d.manifest.name,
                version: d.manifest.version,
                classes: d.counts.classes,
                items: d.counts.items,
                pqs: d.counts.personalQuests,
              })}
            </p>
          )}
          <ErrorText error={imp.error} />
          {imp.isSuccess && (
            <p className="text-sm text-green-700 dark:text-green-400">{t('admin.imported')}</p>
          )}
          <Button disabled={!d?.ok || imp.isPending} onClick={() => imp.mutate()}>
            {t('admin.import')}
          </Button>
        </Card>
      </section>
      <section>
        <h2 className="mb-2 font-medium">{t('admin.dataSets')}</h2>
        <ul className="flex flex-col gap-2">
          {sets.data?.map((s) => (
            <li key={s.id}>
              <Card className="p-3">
                {s.name} ({s.version}) · {new Date(s.importedAt).toLocaleString()}
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
