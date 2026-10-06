import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BaseEffect, Effect } from '@fht/shared';
import { Badge, Button, Card, ErrorText, Input, PageTitle, Select } from '../components/ui.tsx';
import { describeEffect } from '../effects.ts';
import { trpc } from '../trpc.ts';
import { ReadNext } from './dashboard.tsx';

type Tab = 'available' | 'completed' | 'blocked' | 'locked' | 'locked_out';

export function ScenariosPage({
  campaignId,
  open: initial,
}: {
  campaignId: string;
  open?: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(trpc.scenario.list.queryOptions({ campaignId }));
  const [tab, setTab] = useState<Tab>('available');
  // Opened from the map: show just that scenario, expanded.
  const [search, setSearch] = useState(initial === undefined ? '' : String(initial));
  const [open, setOpen] = useState<number | null>(initial ?? null);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.scenario.pathKey() });
  const setStatus = useMutation(trpc.scenario.setStatus.mutationOptions({ onSettled: refresh }));
  const override = useMutation(
    trpc.scenario.overrideRequirement.mutationOptions({ onSettled: refresh }),
  );

  if (q.error) return <ErrorText error={q.error} />;
  if (!q.data) return null;
  const isHost = q.data.role === 'host';
  const tabOf = (s: (typeof q.data.scenarios)[number]): Tab =>
    s.status === 'completed'
      ? 'completed'
      : s.status === 'unlocked'
        ? s.playable
          ? 'available'
          : 'blocked'
        : s.status;
  const counts = q.data.scenarios.reduce<Record<string, number>>(
    (a, s) => ((a[tabOf(s)] = (a[tabOf(s)] ?? 0) + 1), a),
    {},
  );
  const needle = search.trim().toLowerCase();
  const list = q.data.scenarios.filter((s) =>
    needle
      ? String(s.number) === needle || s.name.toLowerCase().includes(needle)
      : tabOf(s) === tab,
  );
  // Players don't see locked scenarios' names (no spoilers).
  const tabs: Tab[] = isHost
    ? ['available', 'completed', 'blocked', 'locked_out', 'locked']
    : ['available', 'completed', 'blocked', 'locked_out'];
  const labels: Record<Tab, string> = {
    available: t('scenarios.available'),
    completed: t('scenarios.completed'),
    blocked: t('scenarios.blocked'),
    locked: t('scenarios.locked'),
    locked_out: t('scenarios.lockedOut'),
  };

  return (
    <>
      <PageTitle>{t('scenarios.title')}</PageTitle>
      <ErrorText error={setStatus.error ?? override.error} />
      <div className="mb-3">
        <Input
          placeholder={t('scenarios.search')}
          aria-label={t('scenarios.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!needle && (
        <div className="mb-4 flex gap-2 overflow-x-auto" role="tablist">
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`min-h-12 shrink-0 rounded-full px-4 text-sm ${tab === k ? 'bg-sky-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
            >
              {labels[k]} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
      )}
      {list.length === 0 && <p className="text-slate-500">{t('scenarios.none')}</p>}
      <ul className="flex flex-col gap-2">
        {list
          .filter((s) => isHost || s.status !== 'locked')
          .map((s) => (
            <li key={s.number}>
              <Card className="p-0">
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 p-3 text-left"
                  aria-expanded={open === s.number}
                  onClick={() => setOpen(open === s.number ? null : s.number)}
                >
                  <span className="w-10 text-right font-mono text-slate-500">{s.number}</span>
                  <span className="flex-1">
                    <span className="font-medium">{s.name}</span>
                    {s.coord && <span className="ml-2 text-sm text-slate-500">{s.coord}</span>}
                  </span>
                  {s.timesCompleted > 0 && (
                    <Badge>{t('scenarios.timesCompleted', { n: s.timesCompleted })}</Badge>
                  )}
                </button>
                {open === s.number && (
                  <div className="flex flex-col gap-2 border-t border-slate-200 p-3 text-sm dark:border-slate-800">
                    {s.region && <p className="text-slate-500">{s.region}</p>}
                    {s.requirements.length > 0 && (
                      <ul>
                        {s.requirements.map((r, i) => (
                          <li key={i}>
                            {t('scenarios.requires')}:{' '}
                            {'campaignSticker' in r
                              ? `"${r.campaignSticker}"${r.minCount > 1 ? ` ×${r.minCount}` : ''}`
                              : r.freeText}{' '}
                            <Badge>
                              {r.met === true || s.requirementOverride
                                ? t('scenarios.met')
                                : t('scenarios.notMet')}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.unlockedBy && (
                      <p className="text-slate-500">
                        {t('scenarios.unlockedBy', { source: s.unlockedBy })}
                      </p>
                    )}
                    {isHost && s.conclusionSections.length > 0 && (
                      <p>
                        {t('scenarios.conclusion')}:{' '}
                        {s.conclusionSections.map((ref) => (
                          <Link
                            key={ref}
                            to="/c/$campaignId/read/$ref"
                            params={{ campaignId, ref }}
                            className="mr-2 underline"
                          >
                            {ref}
                          </Link>
                        ))}
                      </p>
                    )}
                    {isHost && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          aria-label={t('scenarios.setStatus')}
                          value={s.status}
                          onChange={(e) =>
                            setStatus.mutate({
                              campaignId,
                              scenario: s.number,
                              status: e.target.value as
                                'locked' | 'unlocked' | 'completed' | 'locked_out',
                            })
                          }
                        >
                          <option value="locked">{t('scenarios.locked')}</option>
                          <option value="unlocked">{t('scenarios.available')}</option>
                          <option value="completed">{t('scenarios.completed')}</option>
                          <option value="locked_out">{t('scenarios.lockedOut')}</option>
                        </Select>
                        {s.requirements.length > 0 && s.status !== 'locked' && (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              override.mutate({
                                campaignId,
                                scenario: s.number,
                                override: !s.requirementOverride,
                              })
                            }
                          >
                            {s.requirementOverride
                              ? t('scenarios.removeOverride')
                              : t('scenarios.override')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
      </ul>
    </>
  );
}

/** Review and apply a section's effects. */
export function ReadSectionPage({
  campaignId,
  sectionRef,
}: {
  campaignId: string;
  sectionRef: string;
}) {
  const { t } = useTranslation();
  const q = useQuery(trpc.section.get.queryOptions({ campaignId, ref: sectionRef }));
  const scen = useQuery(trpc.scenario.list.queryOptions({ campaignId }));
  const role = scen.data?.role;
  if (q.error) return <ErrorText error={q.error} />;
  if (!q.data) return null;
  const name = (n: number) => {
    const s = scen.data?.scenarios.find((x) => x.number === n);
    return s ? `${n} ${s.name}` : String(n);
  };
  return (
    <>
      <PageTitle>{t('read.title', { ref: sectionRef })}</PageTitle>
      {q.data.title && <p className="-mt-3 mb-4 text-slate-500">{q.data.title}</p>}
      {q.data.appliedAt.length > 0 && (
        <Badge>{t('read.alreadyApplied', { n: q.data.appliedAt.length })}</Badge>
      )}
      {role === 'host' ? (
        <SectionReview
          key={sectionRef}
          campaignId={campaignId}
          sectionRef={sectionRef}
          effects={q.data.effects}
          known={q.data.known}
          rewardsText={q.data.rewardsText}
          name={name}
        />
      ) : (
        <p className="mt-4 text-slate-500">{t('read.playerHint')}</p>
      )}
    </>
  );
}

function SectionReview({
  campaignId,
  sectionRef,
  effects,
  known,
  rewardsText,
  name,
}: {
  campaignId: string;
  sectionRef: string;
  effects: Effect[];
  known: boolean;
  rewardsText: string | null;
  name: (n: number) => string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [included, setIncluded] = useState<boolean[]>(() => effects.map(() => true));
  const [choices, setChoices] = useState<number[]>(() => effects.map(() => -1));
  const commit = useMutation(
    trpc.section.commit.mutationOptions({ onSettled: () => qc.invalidateQueries() }),
  );
  const resolved: BaseEffect[] = effects.flatMap((e, i) => {
    if (!included[i]) return [];
    if (e.type === 'chooseOne') {
      const c = e.options[choices[i] ?? -1];
      return c ? [c] : [];
    }
    return [e];
  });
  const unresolvedChoice = effects.some(
    (e, i) => included[i] && e.type === 'chooseOne' && (choices[i] ?? -1) < 0,
  );

  return (
    <div className="mt-4 flex flex-col gap-4">
      {!known && <Card>{t('read.unknown')}</Card>}
      {rewardsText && (
        <Card>
          <div className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('read.reminder')}
          </div>
          <p className="text-sm">{rewardsText}</p>
        </Card>
      )}
      {effects.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('read.effects')}</legend>
          {effects.map((e, i) => (
            <Card key={i} className="flex flex-col gap-2 p-3">
              <label className="flex min-h-10 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={included[i]}
                  onChange={(ev) =>
                    setIncluded((xs) => xs.map((x, j) => (j === i ? ev.target.checked : x)))
                  }
                />
                <span>{e.type === 'chooseOne' ? t('read.choose') : describeEffect(e, name)}</span>
              </label>
              {e.type === 'chooseOne' &&
                e.options.map((o, k) => (
                  <label key={k} className="ml-9 flex min-h-10 items-center gap-3">
                    <input
                      type="radio"
                      name={`choice-${i}`}
                      className="h-5 w-5"
                      checked={choices[i] === k}
                      onChange={() => setChoices((xs) => xs.map((x, j) => (j === i ? k : x)))}
                    />
                    {describeEffect(o, name)}
                  </label>
                ))}
            </Card>
          ))}
        </fieldset>
      )}
      <ErrorText error={commit.error} />
      {commit.data ? (
        <>
          <p className="text-green-700 dark:text-green-400">{t('read.applied')}</p>
          {commit.data.manual.length > 0 && (
            <Card>
              <p className="font-medium">{t('read.manual')}</p>
              <ul className="list-disc pl-5">
                {commit.data.manual.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Card>
          )}
          <ReadNext campaignId={campaignId} refs={commit.data.readNext} />
        </>
      ) : (
        <Button
          disabled={commit.isPending || unresolvedChoice}
          onClick={() => commit.mutate({ campaignId, ref: sectionRef, effects: resolved })}
        >
          {t('read.apply')}
        </Button>
      )}
    </div>
  );
}
