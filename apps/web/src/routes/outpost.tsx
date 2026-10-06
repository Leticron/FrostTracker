import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
import { ReadNext, Section } from './dashboard.tsx';

const STEPS = [1, 2, 3, 4, 5] as const;

export function OutpostPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const campaign = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  const q = useQuery(trpc.outpost.current.queryOptions({ campaignId }));
  const [readNext, setReadNext] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries();
  const start = useMutation(trpc.outpost.start.mutationOptions({ onSettled: refresh }));
  const passTime = useMutation(trpc.outpost.passTime.mutationOptions({ onSettled: refresh }));
  const setStep = useMutation(trpc.outpost.setStep.mutationOptions({ onSettled: refresh }));
  const close = useMutation(trpc.outpost.close.mutationOptions({ onSettled: refresh }));
  const resolve = useMutation(trpc.state.calendarResolve.mutationOptions({ onSettled: refresh }));
  const isHost = campaign.data?.role === 'host';
  const phase = q.data?.phase;
  const error = start.error ?? passTime.error ?? setStep.error ?? close.error ?? resolve.error;

  return (
    <>
      <PageTitle>{t('outpost.title')}</PageTitle>
      <ErrorText error={error ?? q.error} />
      <ReadNext campaignId={campaignId} refs={readNext} />
      {!phase && (
        <Card className="mb-6 flex flex-wrap items-center gap-3">
          <span className="flex-1">{t('outpost.noPhase')}</span>
          {isHost && (
            <Button onClick={() => start.mutate({ campaignId })}>{t('outpost.start')}</Button>
          )}
        </Card>
      )}
      {phase && (
        <section className="mb-6">
          <ol className="mb-4 flex gap-1 overflow-x-auto">
            {STEPS.map((s) => (
              <li
                key={s}
                aria-current={phase.step === s ? 'step' : undefined}
                className={`shrink-0 rounded-full px-3 py-2 text-sm ${
                  phase.step === s
                    ? 'bg-sky-600 text-white'
                    : phase.step > s
                      ? 'bg-sky-100 dark:bg-sky-950'
                      : 'bg-slate-200 dark:bg-slate-800'
                }`}
              >
                {t(`outpost.step${s}`)}
              </li>
            ))}
          </ol>
          <Card className="flex flex-col gap-3">
            {phase.step === 1 && isHost && (
              <Button onClick={() => passTime.mutate({ campaignId })}>
                {t('outpost.passTime')}
              </Button>
            )}
            {phase.step >= 2 && (
              <div>
                <h3 className="mb-2 font-medium">{t('outpost.dueSections')}</h3>
                {q.data!.due.length === 0 && (
                  <p className="text-sm text-slate-500">{t('outpost.noDue')}</p>
                )}
                <ul className="flex flex-col gap-2">
                  {q.data!.due.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Link
                        to="/c/$campaignId/read/$ref"
                        params={{ campaignId, ref: d.sectionRef }}
                        className="font-semibold underline"
                      >
                        {d.sectionRef}
                      </Link>
                      <span className="flex-1 text-sm text-slate-500">
                        {t('dashboard.inWeek', { week: d.week })}
                      </span>
                      {isHost && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            resolve.mutate({ campaignId, entryId: d.id, resolved: true })
                          }
                        >
                          {t('dashboard.resolve')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {phase.step === 2 && isHost && <EventForm campaignId={campaignId} />}
            {phase.step === 3 && <p className="text-sm">{t('outpost.operationsHint')}</p>}
            {phase.step === 4 && (
              <p className="text-sm">
                {t('outpost.downtimeHint')}{' '}
                <Link to="/c/$campaignId/party" params={{ campaignId }} className="underline">
                  {t('campaign.party')}
                </Link>
              </p>
            )}
            {isHost && phase.step > 1 && (
              <div className="flex flex-wrap gap-2">
                {phase.step > 2 && (
                  <Button
                    variant="ghost"
                    onClick={() => setStep.mutate({ campaignId, step: phase.step - 1 })}
                  >
                    {t('outpost.back')}
                  </Button>
                )}
                {phase.step < 5 ? (
                  <Button onClick={() => setStep.mutate({ campaignId, step: phase.step + 1 })}>
                    {t('outpost.next')}
                  </Button>
                ) : (
                  <Button onClick={() => close.mutate({ campaignId })}>{t('outpost.close')}</Button>
                )}
              </div>
            )}
          </Card>
        </section>
      )}
      <Buildings
        campaignId={campaignId}
        isHost={isHost}
        buildsThisPhase={phase?.builds ?? 0}
        onReadNext={setReadNext}
      />
      <EventLog campaignId={campaignId} />
    </>
  );
}

function EventForm({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [option, setOption] = useState('');
  const [note, setNote] = useState('');
  const log = useMutation(
    trpc.state.logEvent.mutationOptions({
      onSuccess: () => {
        setRef('');
        setOption('');
        setNote('');
      },
      onSettled: () => qc.invalidateQueries({ queryKey: trpc.state.pathKey() }),
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    log.mutate({ campaignId, kind: 'outpost', eventRef: ref, option, note });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field label={t('outpost.eventRef')}>
        <Input required className="w-32" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <Field label={t('outpost.eventOption')}>
        <Input className="w-20" value={option} onChange={(e) => setOption(e.target.value)} />
      </Field>
      <Field label={t('sessions.notes')}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorText error={log.error} />
      <Button type="submit" variant="secondary">
        {t('outpost.logEvent')}
      </Button>
    </form>
  );
}

function Buildings({
  campaignId,
  isHost,
  buildsThisPhase,
  onReadNext,
}: {
  campaignId: string;
  isHost: boolean;
  buildsThisPhase: number;
  onReadNext: (r: string[]) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(trpc.outpost.buildings.queryOptions({ campaignId }));
  const act = useMutation(
    trpc.outpost.building.mutationOptions({
      onSuccess: (r) => onReadNext(r.readNext),
      onSettled: () => qc.invalidateQueries(),
    }),
  );
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  type Action =
    'build' | 'upgrade' | 'wreck' | 'rebuild' | 'damage_repair_pay' | 'damage_repair_morale';
  const run = (n: number, action: Action) => {
    // RULE: R-OUT-14 - the second build of an outpost phase costs morale; ask first.
    const isBuild = action === 'build' || action === 'upgrade';
    if (isBuild && buildsThisPhase === 1 && !confirm(t('outpost.secondBuild'))) return;
    act.mutate({ campaignId, number: n, action, extraBuild: isBuild && buildsThisPhase === 1 });
  };
  const unlockable =
    q.data?.catalog.filter((c) => !q.data!.buildings.some((b) => b.number === c.number)) ?? [];

  return (
    <Section title={t('outpost.buildings')}>
      <ErrorText error={act.error} />
      <ul className="mb-3 flex flex-col gap-2">
        {q.data?.buildings.map((b) => (
          <li key={b.id}>
            <Card className="flex flex-wrap items-center gap-2 p-3">
              <span className="w-10 text-right font-mono text-slate-500">{b.number}</span>
              <span className="flex-1 font-medium">{b.name}</span>
              <Badge>
                {b.state === 'unlocked'
                  ? t('outpost.state_unlocked')
                  : t('outpost.level', { level: b.level })}
              </Badge>
              {b.state === 'wrecked' && <Badge>{t('outpost.state_wrecked')}</Badge>}
              {isHost && (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {b.state === 'unlocked' && (
                    <Button onClick={() => run(b.number, 'build')}>{t('outpost.build')}</Button>
                  )}
                  {b.state === 'built' && (
                    <>
                      <Button variant="secondary" onClick={() => run(b.number, 'upgrade')}>
                        {t('outpost.upgrade')}
                      </Button>
                      <Button variant="ghost" onClick={() => run(b.number, 'damage_repair_pay')}>
                        {t('outpost.repairPay')}
                      </Button>
                      <Button variant="ghost" onClick={() => run(b.number, 'damage_repair_morale')}>
                        {t('outpost.repairMorale')}
                      </Button>
                      <Button variant="ghost" onClick={() => run(b.number, 'wreck')}>
                        {t('outpost.wreck')}
                      </Button>
                    </>
                  )}
                  {b.state === 'wrecked' && (
                    <Button onClick={() => run(b.number, 'rebuild')}>{t('outpost.rebuild')}</Button>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {isHost && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (number)
              act.mutate(
                { campaignId, number: Number(number), name: name || undefined, action: 'unlock' },
                { onSuccess: () => (setNumber(''), setName('')) },
              );
          }}
        >
          {unlockable.length > 0 ? (
            <Field label={t('outpost.buildingName')}>
              <Select value={number} onChange={(e) => setNumber(e.target.value)}>
                <option value="">—</option>
                {unlockable.map((c) => (
                  <option key={c.number} value={c.number}>
                    {c.number} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <Field label={t('outpost.buildingNumber')}>
                <Input
                  inputMode="numeric"
                  className="w-24"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </Field>
              <Field label={t('outpost.buildingName')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </>
          )}
          <Button type="submit" variant="secondary">
            {t('outpost.unlockBuilding')}
          </Button>
        </form>
      )}
    </Section>
  );
}

function EventLog({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const q = useQuery(trpc.state.events.queryOptions({ campaignId }));
  if (!q.data?.events.length && !q.data?.deck.length) return null;
  return (
    <Section title={t('outpost.events')}>
      <ul className="flex flex-col gap-1 text-sm">
        {q.data.events.map((e) => (
          <li key={e.id}>
            {t('dashboard.inWeek', { week: e.week })}: <strong>{e.eventRef}</strong> {e.option}{' '}
            {e.note}
          </li>
        ))}
        {q.data.deck.map((d) => (
          <li key={d.id} className="text-slate-500">
            {d.op === 'add' ? '+' : '−'} {d.eventRef} ({d.deck})
            {d.sectionRef ? ` · ${d.sectionRef}` : ''}
          </li>
        ))}
      </ul>
    </Section>
  );
}
