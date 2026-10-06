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
import { trpc, type RouterOutputs } from '../trpc.ts';

export function SessionsPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const q = useQuery(trpc.session.list.queryOptions({ campaignId }));
  const campaign = useQuery(trpc.campaign.get.queryOptions({ campaignId }));
  return (
    <>
      <PageTitle
        action={
          campaign.data?.role === 'host' && (
            <Link to="/c/$campaignId/sessions/new" params={{ campaignId }}>
              <Button>{t('sessions.new')}</Button>
            </Link>
          )
        }
      >
        {t('sessions.title')}
      </PageTitle>
      <ErrorText error={q.error} />
      {q.data?.length === 0 && <p className="text-slate-500">{t('sessions.empty')}</p>}
      <ul className="flex flex-col gap-2">
        {q.data?.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {s.date} · {s.scenarioNumber !== null ? `#${s.scenarioNumber}` : '—'} · L
                  {s.scenarioLevel}
                </span>
                <Badge>
                  {s.outcome === 'completed' ? t('sessions.completed') : t('sessions.lost')}
                </Badge>
                {s.casual && <Badge>{t('sessions.casual')}</Badge>}
              </div>
              <div className="text-sm text-slate-500">
                {s.participants.map((p) => p.name).join(', ')}
              </div>
              {s.notes && <p className="text-sm">{s.notes}</p>}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

interface Row {
  characterId: string;
  include: boolean;
  coins: string;
  xp: string;
  checkmarks: string;
  masteries: number[];
  resources: Record<string, string>;
}

export function LogSessionPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const form = useQuery(trpc.session.form.queryOptions({ campaignId }));
  if (form.error) return <ErrorText error={form.error} />;
  if (!form.data) return null;
  return <LogSessionForm campaignId={campaignId} data={form.data} t={t} />;
}

function LogSessionForm({
  campaignId,
  data,
  t,
}: {
  campaignId: string;
  data: RouterOutputs['session']['form'];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scenario, setScenario] = useState('');
  const [level, setLevel] = useState(String(data.recommendedLevel));
  const [outcome, setOutcome] = useState<'completed' | 'lost'>('completed');
  const [lostChoice, setLostChoice] = useState<'return' | 'replay'>('return');
  const [casual, setCasual] = useState(false);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>(() =>
    data.characters.map((c) => ({
      characterId: c.id,
      include: true,
      coins: '',
      xp: '',
      checkmarks: '',
      masteries: [],
      resources: {},
    })),
  );
  const log = useMutation(
    trpc.session.log.mutationOptions({ onSettled: () => qc.invalidateQueries() }),
  );
  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string) => (v ? Number(v) : 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    log.mutate({
      campaignId,
      date,
      scenario: scenario === '' ? null : Number(scenario),
      scenarioLevel: Number(level),
      outcome,
      lostChoice: outcome === 'lost' ? lostChoice : null,
      casual,
      notes,
      participants: rows
        .filter((r) => r.include)
        .map((r) => ({
          characterId: r.characterId,
          coins: num(r.coins),
          xp: num(r.xp),
          checkmarks: num(r.checkmarks),
          masteries: r.masteries,
          resources: Object.fromEntries(
            Object.entries(r.resources)
              .filter(([, v]) => num(v) > 0)
              .map(([k, v]) => [k, num(v)]),
          ),
        })),
    });
  };

  if (log.data) {
    const r = log.data;
    return (
      <>
        <PageTitle>{t('sessions.applied')}</PageTitle>
        <Card className="flex flex-col gap-3">
          {r.conclusionSections.length > 0 && (
            <p>
              {r.firstCompletion ? t('sessions.firstCompletion') : t('sessions.replayNoRewards')}{' '}
              {r.firstCompletion &&
                r.conclusionSections.map((ref) => (
                  <Link
                    key={ref}
                    to="/c/$campaignId/read/$ref"
                    params={{ campaignId, ref }}
                    className="mr-2 font-semibold underline"
                  >
                    {ref}
                  </Link>
                ))}
            </p>
          )}
          {r.links.map((l) => (
            <p key={`${l.section}-${l.scenario}`}>
              {l.link === 'forced'
                ? t('sessions.forced', { scenario: l.scenario })
                : t('sessions.linked', { scenario: l.scenario })}
            </p>
          ))}
          <p className="text-sm text-slate-500">
            {r.outpostPhaseFollows ? t('sessions.outpostNext') : t('sessions.noOutpost')}
          </p>
          <div className="flex gap-2">
            <Link to="/c/$campaignId" params={{ campaignId }}>
              <Button variant="secondary">{t('campaign.dashboard')}</Button>
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageTitle>{t('sessions.new')}</PageTitle>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('sessions.date')}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('sessions.scenario')}>
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              <option value="">{t('sessions.noScenario')}</option>
              {data.scenarios.map((s) => (
                <option key={s.number} value={s.number}>
                  {s.number} · {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={`${t('sessions.level')} (${t('sessions.recommended', { level: data.recommendedLevel })})`}
          >
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              {Array.from({ length: data.maxScenarioLevel + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-sm font-medium">{t('sessions.outcome')}</legend>
          {(['completed', 'lost'] as const).map((o) => (
            <label
              key={o}
              className={`flex min-h-12 items-center gap-2 rounded-xl border px-4 ${outcome === o ? 'border-sky-500' : 'border-slate-300 dark:border-slate-700'}`}
            >
              <input
                type="radio"
                name="outcome"
                checked={outcome === o}
                onChange={() => setOutcome(o)}
                className="h-5 w-5"
              />
              {t(`sessions.${o}`)}
            </label>
          ))}
          {outcome === 'lost' &&
            (['return', 'replay'] as const).map((o) => (
              <label
                key={o}
                className={`flex min-h-12 items-center gap-2 rounded-xl border px-4 ${lostChoice === o ? 'border-sky-500' : 'border-slate-300 dark:border-slate-700'}`}
              >
                <input
                  type="radio"
                  name="lostChoice"
                  checked={lostChoice === o}
                  onChange={() => setLostChoice(o)}
                  className="h-5 w-5"
                />
                {t(`sessions.${o}`)}
              </label>
            ))}
        </fieldset>
        <label className="flex min-h-12 items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={casual}
            onChange={(e) => setCasual(e.target.checked)}
          />
          {t('sessions.casual')}
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t('sessions.participants')}</legend>
          {data.characters.map((c, i) => {
            const r = rows[i]!;
            return (
              <Card key={c.id} className={`flex flex-col gap-3 ${r.include ? '' : 'opacity-50'}`}>
                <label className="flex min-h-10 items-center gap-3 font-medium">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={r.include}
                    onChange={(e) => update(i, { include: e.target.checked })}
                  />
                  {c.name} <span className="text-sm font-normal text-slate-500">L{c.level}</span>
                </label>
                {r.include && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label={t('sessions.coins')}>
                        <Input
                          inputMode="numeric"
                          value={r.coins}
                          onChange={(e) => update(i, { coins: e.target.value })}
                        />
                      </Field>
                      <Field label={t('sessions.dialXp')}>
                        <Input
                          inputMode="numeric"
                          value={r.xp}
                          onChange={(e) => update(i, { xp: e.target.value })}
                        />
                      </Field>
                      <Field label={t('sessions.battleGoal')}>
                        <Input
                          inputMode="numeric"
                          value={r.checkmarks}
                          onChange={(e) => update(i, { checkmarks: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div>
                      <div className="mb-1 text-sm font-medium">{t('sessions.loot')}</div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {data.resources.map((res) => (
                          <Field key={res.key} label={res.name}>
                            <Input
                              inputMode="numeric"
                              value={r.resources[res.key] ?? ''}
                              onChange={(e) =>
                                update(i, {
                                  resources: { ...r.resources, [res.key]: e.target.value },
                                })
                              }
                            />
                          </Field>
                        ))}
                      </div>
                    </div>
                    {c.masteries.map((done, m) =>
                      done ? null : (
                        <label key={m} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={r.masteries.includes(m)}
                            onChange={(e) =>
                              update(i, {
                                masteries: e.target.checked
                                  ? [...r.masteries, m]
                                  : r.masteries.filter((x) => x !== m),
                              })
                            }
                          />
                          {t('sessions.newMastery')} {m + 1}
                        </label>
                      ),
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </fieldset>
        <Field label={t('sessions.notes')}>
          <textarea
            className="min-h-20 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <ErrorText error={log.error} />
        <Button type="submit" disabled={log.isPending || !rows.some((r) => r.include)}>
          {t('sessions.save')}
        </Button>
      </form>
    </>
  );
}
