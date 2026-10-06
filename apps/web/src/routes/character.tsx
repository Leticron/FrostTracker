import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Counter } from '../components/Counter.tsx';
import { Badge, Button, Card, ErrorText, Field, Input, PageTitle } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

type CounterField = 'xp' | 'gold' | 'checkmarks' | `resource:${string}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function CharacterPage({
  campaignId,
  characterId,
}: {
  campaignId: string;
  characterId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const opts = trpc.character.get.queryOptions({ characterId });
  const q = useQuery(opts);

  const refresh = () => qc.invalidateQueries({ queryKey: trpc.character.pathKey() });
  const onError = () => refresh();
  const adjust = useMutation(
    trpc.character.adjust.mutationOptions({
      // Optimistic +/-: update the sheet immediately, then reconcile with the server result.
      onMutate: async ({ field, delta }) => {
        await qc.cancelQueries({ queryKey: opts.queryKey });
        qc.setQueryData(opts.queryKey, (old) => {
          if (!old) return old;
          const c = { ...old.character };
          if (field.startsWith('resource:')) {
            const k = field.slice(9);
            c.resources = { ...c.resources, [k]: Math.max(0, (c.resources[k] ?? 0) + delta) };
          } else {
            const f = field as 'xp' | 'gold' | 'checkmarks';
            c[f] = Math.max(0, c[f] + delta);
          }
          return { ...old, character: c };
        });
      },
      onError,
      onSettled: () => refresh(),
    }),
  );
  const levelUp = useMutation(trpc.character.levelUp.mutationOptions({ onSettled: refresh }));
  const setPerk = useMutation(trpc.character.setPerkMarks.mutationOptions({ onSettled: refresh }));
  const setMastery = useMutation(trpc.character.setMastery.mutationOptions({ onSettled: refresh }));
  const changeStatus = useMutation(
    trpc.character.changeStatus.mutationOptions({ onSettled: refresh }),
  );
  const toSupply = useMutation(
    trpc.character.transferToSupply.mutationOptions({ onSettled: refresh }),
  );

  if (q.error) return <ErrorText error={q.error} />;
  if (!q.data) return null;
  const { character: c, derived, rules, classDef, canEdit } = q.data;
  const change = (field: CounterField) => (delta: number) =>
    adjust.mutate({ characterId, field, delta });
  const error =
    adjust.error ??
    levelUp.error ??
    setPerk.error ??
    setMastery.error ??
    changeStatus.error ??
    toSupply.error;

  return (
    <>
      <PageTitle
        action={
          <Link
            to="/c/$campaignId/characters/$characterId/history"
            params={{ campaignId, characterId }}
          >
            <Button variant="secondary">{t('sheet.history')}</Button>
          </Link>
        }
      >
        {c.name}
      </PageTitle>
      <p className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-slate-500">
        <span>
          {classDef?.name ?? c.classKey} · {t('party.level', { level: c.level })}
        </span>
        {derived.maxHp && <span>· {t('sheet.maxHp', { hp: derived.maxHp })}</span>}
        <span>· {t('sheet.owner', { name: q.data.ownerName })}</span>
        {c.status !== 'active' && <Badge>{t(`party.status_${c.status}`)}</Badge>}
        {!canEdit && <Badge>{t('sheet.readOnly')}</Badge>}
      </p>

      <ErrorText error={error} />

      {canEdit && derived.levelUpDue && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-amber-400 bg-amber-50 dark:bg-amber-950">
          <p className="flex-1">{t('sheet.levelUpDue', { level: c.level + 1 })}</p>
          <Button onClick={() => levelUp.mutate({ characterId, mode: 'xp' })}>
            {t('sheet.levelUp')}
          </Button>
        </Card>
      )}
      {canEdit && !derived.levelUpDue && derived.prosperityLevelUpAvailable && (
        <Card className="mb-4 flex flex-wrap items-center gap-3">
          <p className="flex-1">{t('sheet.prosperityLevelUp')}</p>
          <Button
            variant="secondary"
            onClick={() => levelUp.mutate({ characterId, mode: 'prosperity' })}
          >
            {t('sheet.prosperityLevelUpButton')}
          </Button>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Counter
          label={t('sheet.xp')}
          value={c.xp}
          disabled={!canEdit}
          onChange={change('xp')}
          hint={
            derived.nextLevelXp !== null
              ? t('sheet.nextLevel', { xp: derived.nextLevelXp })
              : t('sheet.maxLevel')
          }
        />
        <Counter
          label={t('sheet.gold')}
          value={c.gold}
          disabled={!canEdit}
          onChange={change('gold')}
        />
        <Counter
          label={t('sheet.checkmarks')}
          value={c.checkmarks}
          disabled={!canEdit || c.checkmarks >= rules.checkmarksMax}
          onChange={change('checkmarks')}
          hint={`${c.checkmarks} / ${rules.checkmarksMax}`}
        />
      </div>

      <Section title={t('sheet.resources')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rules.resources.map((r) => (
            <div key={r.key}>
              <Counter
                label={r.name}
                value={c.resources[r.key] ?? 0}
                disabled={!canEdit}
                onChange={change(`resource:${r.key}`)}
                hint={
                  canEdit && (c.resources[r.key] ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        toSupply.mutate({ characterId, resourceKey: r.key, amount: 1 })
                      }
                    >
                      1 → {t('sheet.toSupply')}
                    </button>
                  ) : undefined
                }
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('sheet.perks')}>
        <p className="mb-2 text-sm">
          {t('sheet.perkMarks', {
            available: derived.perkMarksAvailable,
            earned: derived.perkMarksEarned,
          })}
        </p>
        {!classDef?.perks.length && <p className="text-sm text-slate-500">{t('sheet.noPerks')}</p>}
        <ul className="flex flex-col gap-2">
          {classDef?.perks.map((p, i) => {
            const marked = c.perkMarks[i] ?? 0;
            return (
              <li key={i}>
                <Card className="flex items-center gap-3 p-3">
                  <div
                    className={`flex gap-1 ${p.linked ? 'rounded-lg ring-2 ring-slate-300 dark:ring-slate-700' : ''}`}
                  >
                    {Array.from({ length: p.boxes }, (_, b) => (
                      <button
                        key={b}
                        type="button"
                        disabled={!canEdit}
                        aria-label={`${p.text} ${b + 1}`}
                        aria-pressed={b < marked}
                        onClick={() =>
                          setPerk.mutate({
                            characterId,
                            perkIndex: i,
                            marked: b < marked ? b : b + 1,
                          })
                        }
                        className={`h-12 w-12 rounded-lg border-2 text-lg font-bold ${
                          b < marked
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {b < marked ? '✓' : ''}
                      </button>
                    ))}
                  </div>
                  <span className="flex-1 text-sm">{p.text}</span>
                </Card>
              </li>
            );
          })}
        </ul>
      </Section>

      {!!classDef?.masteries.length && (
        <Section title={t('sheet.masteries')}>
          <ul className="flex flex-col gap-2">
            {classDef.masteries.map((m, i) => (
              <li key={i}>
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    disabled={!canEdit}
                    checked={c.masteries[i] ?? false}
                    onChange={(e) =>
                      setMastery.mutate({
                        characterId,
                        masteryIndex: i,
                        achieved: e.target.checked,
                      })
                    }
                  />
                  <span className="text-sm">{m}</span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ItemsSection
        characterId={characterId}
        canEdit={canEdit}
        items={q.data.items}
        onChanged={refresh}
      />
      <QuestAndNotes
        // Re-mount when the saved values change (e.g. after a revert), keeping local edits otherwise.
        key={JSON.stringify([
          c.personalQuestNumber,
          c.personalQuestText,
          c.personalQuestProgress,
          c.notes,
        ])}
        characterId={characterId}
        canEdit={canEdit}
        pqNumber={c.personalQuestNumber}
        pqText={c.personalQuestText}
        pqName={q.data.personalQuest?.name ?? null}
        progress={c.personalQuestProgress}
        notes={c.notes}
        onSaved={refresh}
      />

      {canEdit && (
        <Section title={t('sheet.status')}>
          <div className="flex flex-wrap gap-2">
            {c.status === 'active' && (
              <Button
                variant="secondary"
                onClick={() => changeStatus.mutate({ characterId, action: 'set_aside' })}
              >
                {t('sheet.setAside')}
              </Button>
            )}
            {c.status === 'set_aside' && (
              <Button
                variant="secondary"
                onClick={() => changeStatus.mutate({ characterId, action: 'reactivate' })}
              >
                {t('sheet.reactivate')}
              </Button>
            )}
            {c.status === 'active' && (
              <Button
                onClick={() =>
                  confirm(t('sheet.confirmRetire')) &&
                  changeStatus.mutate({ characterId, action: 'retire' })
                }
              >
                {t('sheet.retire')}
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() =>
                confirm(t('sheet.confirmAbandon')) &&
                changeStatus.mutate({ characterId, action: 'abandon' })
              }
            >
              {t('sheet.abandon')}
            </Button>
          </div>
        </Section>
      )}
    </>
  );
}

function ItemsSection({
  characterId,
  canEdit,
  items,
  onChanged,
}: {
  characterId: string;
  canEdit: boolean;
  items: { id: string; name: string; itemNumber: number | null }[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const add = useMutation(
    trpc.character.addItem.mutationOptions({
      onSuccess: () => {
        setNumber('');
        setName('');
      },
      onSettled: onChanged,
    }),
  );
  const sell = useMutation(trpc.character.sellItem.mutationOptions({ onSettled: onChanged }));
  const remove = useMutation(trpc.character.removeItem.mutationOptions({ onSettled: onChanged }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({
      characterId,
      itemNumber: number ? Number(number) : undefined,
      name: name || undefined,
    });
  };
  const sellItem = (id: string, hasNumber: boolean) => {
    if (hasNumber) return sell.mutate({ characterItemId: id });
    const gold = prompt(t('sheet.sellGold'));
    if (gold !== null && /^\d+$/.test(gold))
      sell.mutate({ characterItemId: id, gold: Number(gold) });
  };
  return (
    <Section title={t('sheet.items')}>
      <ErrorText error={add.error ?? sell.error ?? remove.error} />
      <ul className="mb-3 flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.id}>
            <Card className="flex flex-wrap items-center gap-2 p-3">
              <span className="flex-1">
                {i.itemNumber !== null && (
                  <span className="mr-2 text-slate-500">#{i.itemNumber}</span>
                )}
                {i.name}
              </span>
              {canEdit && (
                <>
                  <Button variant="secondary" onClick={() => sellItem(i.id, i.itemNumber !== null)}>
                    {t('sheet.sell')}
                  </Button>
                  <Button variant="ghost" onClick={() => remove.mutate({ characterItemId: i.id })}>
                    {t('sheet.remove')}
                  </Button>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Field label={t('sheet.itemNumber')}>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              className="w-28"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field label={t('sheet.itemName')}>
            <Input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={(!number && !name) || add.isPending}>
            {t('sheet.addItem')}
          </Button>
        </form>
      )}
    </Section>
  );
}

function QuestAndNotes(props: {
  characterId: string;
  canEdit: boolean;
  pqNumber: number | null;
  pqText: string | null;
  pqName: string | null;
  progress: string;
  notes: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [pqNumber, setPqNumber] = useState(props.pqNumber?.toString() ?? '');
  const [pqText, setPqText] = useState(props.pqText ?? '');
  const [progress, setProgress] = useState(props.progress);
  const [notes, setNotes] = useState(props.notes);
  const save = useMutation(trpc.character.update.mutationOptions({ onSettled: props.onSaved }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      characterId: props.characterId,
      personalQuestNumber: pqNumber ? Number(pqNumber) : null,
      personalQuestText: pqText || null,
      personalQuestProgress: progress,
      notes,
    });
  };
  const ta =
    'min-h-24 rounded-xl border border-slate-300 bg-white p-3 text-base dark:border-slate-700 dark:bg-slate-900';
  return (
    <Section title={t('sheet.personalQuest')}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label={t('sheet.pqNumber')}>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              className="w-28"
              disabled={!props.canEdit}
              value={pqNumber}
              onChange={(e) => setPqNumber(e.target.value)}
            />
          </Field>
          <div className="flex-1">
            {props.pqName ? (
              <p className="pt-7 font-medium">{props.pqName}</p>
            ) : (
              <Field label={t('sheet.pqText')}>
                <Input
                  disabled={!props.canEdit}
                  maxLength={200}
                  value={pqText}
                  onChange={(e) => setPqText(e.target.value)}
                />
              </Field>
            )}
          </div>
        </div>
        <Field label={t('sheet.pqProgress')}>
          <textarea
            className={ta}
            disabled={!props.canEdit}
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
          />
        </Field>
        <Field label={t('sheet.notes')}>
          <textarea
            className={ta}
            disabled={!props.canEdit}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <ErrorText error={save.error} />
        {props.canEdit && (
          <Button type="submit" variant="secondary" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        )}
      </form>
    </Section>
  );
}

const FIELD_LABELS: Record<string, string> = {
  morale: 'Morale',
  inspiration: 'Inspiration',
  soldiers: 'Soldiers',
  defense: 'Defense',
  currentWeek: 'Week',
  count: 'Count',
  timesCompleted: 'Completed',
  requirementOverride: 'Requirement override',
  resolvedAt: 'Resolved',
  state: 'State',
  xp: 'XP',
  gold: 'Gold',
  checkmarks: 'Checkmarks',
  level: 'Level',
  status: 'Status',
  name: 'Name',
  notes: 'Notes',
  perkMarks: 'Perks',
  masteries: 'Masteries',
  resources: 'Resources',
  supply: 'Frosthaven supply',
  prosperityChecks: 'Prosperity',
  personalQuestNumber: 'Personal quest',
  personalQuestText: 'Personal quest',
  personalQuestProgress: 'Quest progress',
  retiredAt: 'Retired',
};

export function describe(entity: string, before: unknown, after: unknown): string {
  if (!before || !after) {
    const row = (after ?? before) as Record<string, unknown> | null;
    const label =
      row?.name ??
      row?.sectionRef ??
      row?.eventRef ??
      row?.scenarioNumber ??
      row?.number ??
      row?.note ??
      '';
    return `${after ? '+' : '−'} ${entity.replaceAll('_', ' ')} ${String(label)}`.trim();
  }
  if (!before || !after) return '';
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .map((k) => `${FIELD_LABELS[k] ?? k}: ${short(b[k])} → ${short(a[k])}`)
    .join(', ');
}

function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    if (Array.isArray(v))
      return `[${v.map((x) => (x === true ? '✓' : x === false ? '·' : String(x))).join(' ')}]`;
    return (
      Object.entries(v as Record<string, unknown>)
        .filter(([, n]) => n)
        .map(([k, n]) => `${k} ${String(n)}`)
        .join(', ') || '—'
    );
  }
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

export function CharacterHistoryPage({ characterId }: { characterId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(trpc.character.history.queryOptions({ characterId }));
  const revert = useMutation(
    trpc.character.revert.mutationOptions({
      onSettled: () => qc.invalidateQueries({ queryKey: trpc.character.pathKey() }),
    }),
  );
  if (!q.data) return <ErrorText error={q.error} />;
  // Group entries of one action together (newest first).
  const groups = new Map<string, typeof q.data.entries>();
  for (const e of q.data.entries) groups.set(e.groupId, [...(groups.get(e.groupId) ?? []), e]);
  return (
    <>
      <PageTitle>{t('history.title')}</PageTitle>
      <ErrorText error={revert.error} />
      {groups.size === 0 && <p className="text-slate-500">{t('history.empty')}</p>}
      <ul className="flex flex-col gap-2">
        {[...groups.entries()].map(([groupId, entries]) => {
          const first = entries[0]!;
          const reverted = entries.some((e) => e.revertedBy);
          const isRevert = first.action.startsWith('revert_');
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
                      .join(' · ')}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(first.at).toLocaleString()} ·{' '}
                    {t('history.by', { name: first.actorName ?? '—' })}
                  </div>
                </div>
                {q.data.canRevert && !reverted && !isRevert && first.action !== 'create' && (
                  <Button
                    variant="secondary"
                    disabled={revert.isPending}
                    onClick={() => revert.mutate({ groupId })}
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
