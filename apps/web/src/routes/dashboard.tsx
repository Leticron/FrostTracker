import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Counter } from '../components/Counter.tsx';
import { Badge, Button, Card, ErrorText, Field, Input, PageTitle } from '../components/ui.tsx';
import { trpc } from '../trpc.ts';

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Shows "read next" section links returned by a mutation. */
export function ReadNext({ campaignId, refs }: { campaignId: string; refs: string[] }) {
  const { t } = useTranslation();
  if (!refs.length) return null;
  return (
    <Card className="mb-4 border-amber-400 bg-amber-50 dark:bg-amber-950">
      {t('dashboard.readNext')}
      {refs.map((ref) => (
        <Link
          key={ref}
          to="/c/$campaignId/read/$ref"
          params={{ campaignId, ref }}
          className="mr-2 font-semibold underline"
        >
          {ref}
        </Link>
      ))}
    </Card>
  );
}

export function SectionJump({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ref, setRef] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d{1,3}\.\d{1,2}$/.test(ref.trim())) {
      void navigate({ to: '/c/$campaignId/read/$ref', params: { campaignId, ref: ref.trim() } });
    }
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <Field label={t('dashboard.sectionRef')}>
        <Input
          inputMode="decimal"
          pattern="\d{1,3}\.\d{1,2}"
          className="w-36"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="secondary">
        {t('dashboard.read')}
      </Button>
    </form>
  );
}

export function CampaignDashboardPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(trpc.state.get.queryOptions({ campaignId }));
  const [readNext, setReadNext] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.state.pathKey() });
  const adjust = useMutation(
    trpc.state.adjust.mutationOptions({
      onSuccess: (r) => setReadNext(r.readNext),
      onSettled: refresh,
    }),
  );
  const setMorale = useMutation(trpc.state.setMorale.mutationOptions({ onSettled: refresh }));
  const sticker = useMutation(trpc.state.sticker.mutationOptions({ onSettled: refresh }));
  const treasure = useMutation(trpc.state.treasure.mutationOptions({ onSettled: refresh }));
  const resolve = useMutation(trpc.state.calendarResolve.mutationOptions({ onSettled: refresh }));
  const startOutpost = useMutation(
    trpc.outpost.start.mutationOptions({
      onSettled: () => qc.invalidateQueries(),
    }),
  );
  const [stickerName, setStickerName] = useState('');
  const [treasureNo, setTreasureNo] = useState('');
  const [initialMorale, setInitialMorale] = useState('');

  if (q.error) return <ErrorText error={q.error} />;
  if (!q.data) return null;
  const { campaign: c, derived: d, role } = q.data;
  const isHost = role === 'host';
  const change =
    (
      field: 'morale' | 'prosperity' | 'inspiration' | 'soldiers' | 'defense' | `supply:${string}`,
    ) =>
    (delta: number) =>
      adjust.mutate({ campaignId, field, delta });
  const error =
    adjust.error ??
    setMorale.error ??
    sticker.error ??
    treasure.error ??
    resolve.error ??
    startOutpost.error;

  return (
    <>
      <PageTitle
        action={
          isHost && (
            <Link to="/c/$campaignId/sessions/new" params={{ campaignId }}>
              <Button>{t('dashboard.logSession')}</Button>
            </Link>
          )
        }
      >
        {c.name}
      </PageTitle>
      <p className="-mt-3 mb-4 text-slate-500">
        {t('dashboard.week', {
          week: d.next.weekInSeason,
          year: d.next.year,
          season: t(`dashboard.${d.next.season}`),
        })}{' '}
        · {t('dashboard.weeksMarked', { n: c.currentWeek })}
      </p>
      <ErrorText error={error} />
      <ReadNext campaignId={campaignId} refs={readNext} />

      {q.data.outpost ? (
        <Card className="mb-4 flex flex-wrap items-center gap-3">
          <span className="flex-1">
            {t('dashboard.outpostOpen', { step: q.data.outpost.step })}
          </span>
          <Link to="/c/$campaignId/outpost" params={{ campaignId }}>
            <Button variant="secondary">{t('dashboard.continueOutpost')}</Button>
          </Link>
        </Card>
      ) : (
        isHost && (
          <div className="mb-4">
            <Button variant="secondary" onClick={() => startOutpost.mutate({ campaignId })}>
              {t('dashboard.startOutpost')}
            </Button>
          </div>
        )
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Counter
          label={t('dashboard.prosperity')}
          value={c.prosperityChecks}
          disabled={!isHost}
          onChange={change('prosperity')}
          hint={
            d.prosperityNextAt
              ? t('dashboard.prosperityHint', { level: d.prosperity, next: d.prosperityNextAt })
              : t('dashboard.prosperityMax', { level: d.prosperity })
          }
        />
        {c.morale === null ? (
          <Card className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('dashboard.morale')}
            </span>
            {isHost && (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (initialMorale)
                    setMorale.mutate({ campaignId, morale: Number(initialMorale) });
                }}
              >
                <Input
                  inputMode="numeric"
                  className="w-24"
                  aria-label={t('dashboard.setMorale')}
                  value={initialMorale}
                  onChange={(e) => setInitialMorale(e.target.value)}
                />
                <Button type="submit" variant="secondary">
                  {t('dashboard.setMorale')}
                </Button>
              </form>
            )}
          </Card>
        ) : (
          <Counter
            label={t('dashboard.morale')}
            value={c.morale}
            min={d.moraleRange.min}
            disabled={!isHost}
            onChange={change('morale')}
            hint={t('dashboard.moraleHint', {
              mod: d.moraleDefenseModifier === null ? '—' : signed(d.moraleDefenseModifier),
            })}
          />
        )}
        <Counter
          label={t('dashboard.defense')}
          value={c.defense}
          min={-999}
          disabled={!isHost}
          onChange={change('defense')}
          hint={t('dashboard.defenseHint', { total: d.effectiveDefense })}
        />
        <Counter
          label={t('dashboard.soldiers')}
          value={c.soldiers}
          disabled={!isHost}
          onChange={change('soldiers')}
        />
        <Counter
          label={t('dashboard.inspiration')}
          value={c.inspiration}
          disabled={!isHost}
          onChange={change('inspiration')}
        />
      </div>

      <Section title={t('dashboard.supply')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.resources.map((r) => (
            <Counter
              key={r.key}
              label={r.name}
              value={c.supply[r.key] ?? 0}
              disabled={!isHost}
              onChange={change(`supply:${r.key}`)}
            />
          ))}
        </div>
      </Section>

      <Section title={t('dashboard.calendar')}>
        {q.data.calendar.length === 0 && <p className="text-sm text-slate-500">—</p>}
        <ul className="flex flex-col gap-2">
          {q.data.calendar.map((e) => (
            <li key={e.id}>
              <Card className="flex flex-wrap items-center gap-2 p-3">
                <Link
                  to="/c/$campaignId/read/$ref"
                  params={{ campaignId, ref: e.sectionRef }}
                  className="font-semibold underline"
                >
                  {e.sectionRef}
                </Link>
                <span className="flex-1 text-sm text-slate-500">
                  {e.week <= c.currentWeek ? (
                    <Badge>{t('dashboard.due')}</Badge>
                  ) : (
                    t('dashboard.inWeek', { week: e.week })
                  )}
                </span>
                {isHost && e.week <= c.currentWeek && (
                  <Button
                    variant="secondary"
                    onClick={() => resolve.mutate({ campaignId, entryId: e.id, resolved: true })}
                  >
                    {t('dashboard.resolve')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('dashboard.stickers')}>
        <div className="mb-2 flex flex-wrap gap-2">
          {q.data.stickers.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-800"
            >
              {s.name}
              {s.count > 1 && <strong>×{s.count}</strong>}
              {isHost && (
                <button
                  type="button"
                  className="ml-1 min-h-8 min-w-8"
                  aria-label={`${s.name} −1`}
                  onClick={() => sticker.mutate({ campaignId, name: s.name, delta: -1 })}
                >
                  −
                </button>
              )}
            </span>
          ))}
        </div>
        {isHost && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (stickerName.trim())
                sticker.mutate(
                  { campaignId, name: stickerName.trim(), delta: 1 },
                  { onSuccess: () => setStickerName('') },
                );
            }}
          >
            <Field label={t('dashboard.stickerName')}>
              <Input
                list="sticker-names"
                value={stickerName}
                onChange={(e) => setStickerName(e.target.value)}
              />
            </Field>
            <datalist id="sticker-names">
              {q.data.stickers.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <Button type="submit" variant="secondary">
              {t('dashboard.addSticker')}
            </Button>
          </form>
        )}
      </Section>

      <Section title={t('dashboard.readSection')}>
        <SectionJump campaignId={campaignId} />
      </Section>

      <Section title={t('dashboard.treasures')}>
        <p className="mb-2 text-sm">
          {q.data.treasures.length ? q.data.treasures.join(', ') : '—'}
        </p>
        {isHost && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (treasureNo)
                treasure.mutate(
                  { campaignId, number: Number(treasureNo), looted: true },
                  { onSuccess: () => setTreasureNo('') },
                );
            }}
          >
            <Field label={t('dashboard.treasureNumber')}>
              <Input
                inputMode="numeric"
                className="w-28"
                value={treasureNo}
                onChange={(e) => setTreasureNo(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              {t('dashboard.addTreasure')}
            </Button>
          </form>
        )}
      </Section>
    </>
  );
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}
