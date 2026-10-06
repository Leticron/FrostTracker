import 'leaflet/dist/leaflet.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Marker,
  Popup,
  useMapEvents,
} from 'react-leaflet';
import { fitGrid, gridExtent, parseCoord, suggestPosition } from '@fht/rules';
import type { MapLayer } from '@fht/shared';
import { Button, Card, ErrorText, PageTitle, Select } from '../components/ui.tsx';
import { trpc, type RouterOutputs } from '../trpc.ts';

type Scenario = RouterOutputs['scenario']['list']['scenarios'][number];
type Look = 'available' | 'completed' | 'blocked' | 'locked_out' | 'locked';
interface Size {
  w: number;
  h: number;
}
interface Pin {
  scenario: Scenario;
  x: number;
  y: number;
}

const lookOf = (s: Scenario): Look =>
  s.status === 'completed'
    ? 'completed'
    : s.status === 'unlocked'
      ? s.playable
        ? 'available'
        : 'blocked'
      : s.status;

const lookClass: Record<Look, string> = {
  available: 'bg-sky-600 text-white border-white',
  completed: 'bg-emerald-600 text-white border-white',
  blocked: 'bg-amber-400 text-slate-950 border-white',
  locked_out: 'bg-slate-500 text-white border-white line-through',
  locked: 'bg-white text-slate-500 border-dashed border-slate-400',
};

const iconCache = new Map<string, L.DivIcon>();
function icon(s: Scenario, selected: boolean): L.DivIcon {
  const key = `${s.number}:${lookOf(s)}:${selected}`;
  let i = iconCache.get(key);
  if (!i) {
    i = L.divIcon({
      className: '',
      // The outer span keeps a 36px tap target; the dot shrinks when the map is shown small.
      html: `<span class="flex size-9 items-center justify-center"><span class="flex size-9 items-center justify-center rounded-full border-2 text-sm font-bold shadow-md group-[.compact]:size-4 group-[.compact]:border group-[.compact]:text-[0px] ${lookClass[lookOf(s)]} ${selected ? 'ring-4 ring-fuchsia-500' : ''}">${s.number}</span></span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18],
    });
    iconCache.set(key, i);
  }
  return i;
}

// Placeholder grid (no map image): letters as columns, numbers as rows, "FR" in a strip below.
const CELL = 60;
const PAD = 30;
const FR_STRIP = 90;

function placeholder(scenarios: Scenario[]): { url: string; size: Size; pins: Pin[] } {
  const { letters, numbers } = gridExtent(scenarios.map((s) => s.coord));
  const w = PAD + letters * CELL + 10;
  const gridBottom = PAD + numbers * CELL;
  const h = gridBottom + FR_STRIP;
  const lines: string[] = [];
  for (let l = 0; l <= letters; l++) {
    const x = PAD + l * CELL;
    lines.push(`<line x1="${x}" y1="${PAD}" x2="${x}" y2="${gridBottom}"/>`);
    if (l < letters)
      lines.push(`<text x="${x + CELL / 2}" y="${PAD - 10}">${String.fromCharCode(65 + l)}</text>`);
  }
  for (let n = 0; n <= numbers; n++) {
    const y = PAD + n * CELL;
    lines.push(`<line x1="${PAD}" y1="${y}" x2="${PAD + letters * CELL}" y2="${y}"/>`);
    if (n < numbers) lines.push(`<text x="${PAD / 2}" y="${y + CELL / 2 + 5}">${n + 1}</text>`);
  }
  lines.push(
    `<rect x="${PAD}" y="${gridBottom + 15}" width="${letters * CELL}" height="${FR_STRIP - 25}" rx="12"/>`,
    `<text x="${PAD + 40}" y="${gridBottom + 32}">FR</text>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="none" stroke="#94a3b8" stroke-width="1" font-family="sans-serif" font-size="14">${lines.join('')}</g><style>text{fill:#64748b;stroke:none;text-anchor:middle}rect{fill:#94a3b81a}</style></svg>`;

  const pins: Pin[] = [];
  const byCell = new Map<string, Scenario[]>();
  const fr: Scenario[] = [];
  for (const s of scenarios) {
    const c = parseCoord(s.coord);
    if (!c) {
      if (s.coord?.trim().toUpperCase() === 'FR') fr.push(s);
      continue;
    }
    const k = `${c.letter}:${c.number}`;
    byCell.set(k, [...(byCell.get(k) ?? []), s]);
  }
  for (const group of byCell.values()) {
    const c = parseCoord(group[0]!.coord)!;
    group.forEach((s, i) => {
      const dx = (i - (group.length - 1) / 2) * 22;
      pins.push({
        scenario: s,
        x: (PAD + (c.letter + 0.5) * CELL + dx) / w,
        y: (PAD + (c.number - 0.5) * CELL) / h,
      });
    });
  }
  const perRow = Math.max(1, Math.floor((letters * CELL - 80) / 44));
  fr.forEach((s, i) => {
    pins.push({
      scenario: s,
      x: (PAD + 80 + (i % perRow) * 44) / w,
      y: (gridBottom + 50 + Math.floor(i / perRow) * 40) / h,
    });
  });
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, size: { w, h }, pins };
}

/** Natural size of an image, or `failed` if it cannot be loaded. */
function useImageSize(url: string | null) {
  const [state, setState] = useState<{ url: string; size: Size | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setState({ url, size: { w: img.naturalWidth, h: img.naturalHeight } });
    img.onerror = () => setState({ url, size: null });
    img.src = url;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);
  if (!url) return { loading: false, size: null, failed: false };
  if (state?.url !== url) return { loading: true, size: null, failed: false };
  return { loading: false, size: state.size, failed: !state.size };
}

const toLatLng = (x: number, y: number, s: Size): L.LatLngTuple => [-y * s.h, x * s.w];

/**
 * Marks the map "compact" while the image is shown narrower than this, so markers become small
 * dots instead of overlapping number badges (phones, zoomed out).
 */
const COMPACT_BELOW_PX = 600;

function CompactWhenSmall({ size }: { size: Size }) {
  const map = useMapEvents({ zoomend: () => update() });
  const update = () => {
    const shown = map.latLngToContainerPoint([0, size.w]).x - map.latLngToContainerPoint([0, 0]).x;
    map.getContainer().classList.toggle('compact', shown < COMPACT_BELOW_PX);
  };
  useEffect(update);
  return null;
}

function ClickToPlace({ size, onPlace }: { size: Size; onPlace: (x: number, y: number) => void }) {
  useMapEvents({
    click(e) {
      const x = e.latlng.lng / size.w;
      const y = -e.latlng.lat / size.h;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPlace(x, y);
    },
  });
  return null;
}

export function MapPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery(trpc.scenario.list.queryOptions({ campaignId }));
  const images = useQuery(trpc.map.images.queryOptions({ campaignId }));
  const [layer, setLayer] = useState<MapLayer>('world');
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showLocked, setShowLocked] = useState(false);
  const setMarker = useMutation(
    trpc.map.setMarker.mutationOptions({
      onSettled: () => qc.invalidateQueries({ queryKey: trpc.scenario.list.queryKey() }),
    }),
  );
  const exportScenarios = useMutation({
    mutationFn: () => qc.fetchQuery(trpc.map.exportScenarios.queryOptions({ campaignId })),
    onSuccess: (data) => {
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'scenarios.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  });

  const imageUrl = images.data?.[layer] ?? null;
  const image = useImageSize(imageUrl);
  const scenarios = useMemo(() => list.data?.scenarios ?? [], [list.data]);
  const isHost = list.data?.role === 'host';
  const placeMode = isHost && placing && !!image.size;
  const visible = scenarios.filter((s) => placeMode || showLocked || s.status !== 'locked');
  const fit = useMemo(
    () =>
      fitGrid(
        scenarios.flatMap((s) =>
          s.marker?.layer === 'world' ? [{ coord: s.coord, x: s.marker.x, y: s.marker.y }] : [],
        ),
      ),
    [scenarios],
  );

  if (list.error || images.error) return <ErrorText error={list.error ?? images.error} />;
  if (!list.data || !images.data || image.loading) return null;

  const hasTown = !!images.data.town || scenarios.some((s) => s.marker?.layer === 'town');
  const grid = !image.size && layer === 'world' ? placeholder(visible) : null;
  const size = image.size ?? grid?.size ?? null;
  const url = image.size ? imageUrl : (grid?.url ?? null);
  const pins: Pin[] = image.size
    ? visible.flatMap((s) =>
        s.marker && s.marker.layer === layer ? [{ scenario: s, x: s.marker.x, y: s.marker.y }] : [],
      )
    : (grid?.pins ?? []);
  // FR scenarios sit in the lower half of the world map too (R-SCN-18); "town" is optional.
  const unplaced = image.size && layer === 'world' ? visible.filter((s) => !s.marker).length : 0;

  const current = scenarios.find((s) => s.number === selected) ?? null;
  const suggestion = placeMode && layer === 'world' ? suggestPosition(current?.coord, fit) : null;
  const nextUnplaced = (after: number) =>
    scenarios.find((s) => s.number > after && !s.marker)?.number ??
    scenarios.find((s) => !s.marker && s.number !== after)?.number ??
    null;
  const place = (x: number, y: number) => {
    if (!current) return;
    setMarker.mutate(
      { campaignId, scenario: current.number, marker: { x, y, layer } },
      { onSuccess: () => setSelected(nextUnplaced(current.number)) },
    );
  };
  const startPlacing = () => {
    setPlacing(true);
    if (selected === null) setSelected(nextUnplaced(-1) ?? scenarios[0]?.number ?? null);
  };

  return (
    <>
      <PageTitle
        action={
          isHost &&
          image.size &&
          (placing ? (
            <Button variant="secondary" onClick={() => setPlacing(false)}>
              {t('map.donePlacing')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={startPlacing}>
              {t('map.placeMode')}
            </Button>
          ))
        }
      >
        {t('map.title')}
      </PageTitle>
      <ErrorText error={setMarker.error ?? exportScenarios.error} />

      {hasTown && (
        <div className="mb-3 flex gap-2" role="tablist">
          {(['world', 'town'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={layer === k}
              onClick={() => setLayer(k)}
              className={`min-h-12 rounded-full px-4 text-sm ${layer === k ? 'bg-sky-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
            >
              {t(`map.${k}`)}
            </button>
          ))}
        </div>
      )}

      {placeMode && (
        <Card className="mb-3 flex flex-col gap-2">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('map.placeHelp')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('map.scenario')}
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value === '' ? null : Number(e.target.value))}
              className="min-w-0 flex-1"
            >
              {scenarios.map((s) => (
                <option key={s.number} value={s.number}>
                  {s.number} · {s.name}
                  {s.coord ? ` (${s.coord})` : ''}
                  {s.marker ? ` ✓ ${t('map.placed')}` : ''}
                </option>
              ))}
            </Select>
            {suggestion && (
              <Button
                variant="secondary"
                disabled={setMarker.isPending}
                onClick={() => place(suggestion.x, suggestion.y)}
              >
                {t('map.useSuggestion')}
              </Button>
            )}
            {current?.marker && (
              <Button
                variant="ghost"
                disabled={setMarker.isPending}
                onClick={() =>
                  setMarker.mutate({ campaignId, scenario: current.number, marker: null })
                }
              >
                {t('map.removeMarker')}
              </Button>
            )}
          </div>
          {suggestion && <p className="text-sm text-slate-500">{t('map.suggestionHelp')}</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
            <Button
              variant="ghost"
              disabled={exportScenarios.isPending}
              onClick={() => exportScenarios.mutate()}
            >
              {t('map.export')}
            </Button>
            <p className="flex-1 text-sm text-slate-500">{t('map.exportHelp')}</p>
          </div>
        </Card>
      )}

      {image.failed && <p className="mb-2 text-sm text-amber-700">{t('map.imageError')}</p>}
      {!imageUrl && layer === 'world' && (
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">{t('map.placeholder')}</p>
      )}
      {isHost && placing && !image.size && (
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">
          {t('map.placeNeedsImage')}
        </p>
      )}

      {size && url ? (
        // `isolate` keeps Leaflet's high z-indexes below the app's header and tab bar.
        <div
          className="relative isolate z-0 h-[60dvh] min-h-80 overflow-hidden rounded-2xl border border-slate-200 md:h-[70dvh] dark:border-slate-800"
          data-testid="campaign-map"
        >
          <MapContainer
            key={url}
            crs={L.CRS.Simple}
            bounds={[toLatLng(0, 1, size), toLatLng(1, 0, size)]}
            maxBounds={[toLatLng(-0.25, 1.25, size), toLatLng(1.25, -0.25, size)]}
            minZoom={-5}
            maxZoom={3}
            zoomSnap={0.25}
            attributionControl={false}
            className={`group h-full w-full bg-slate-100 dark:bg-slate-900 ${placeMode ? 'cursor-crosshair' : ''}`}
          >
            <ImageOverlay url={url} bounds={[toLatLng(0, 1, size), toLatLng(1, 0, size)]} />
            <CompactWhenSmall size={size} />
            {placeMode && <ClickToPlace size={size} onPlace={place} />}
            {suggestion && (
              <CircleMarker
                center={toLatLng(suggestion.x, suggestion.y, size)}
                radius={22}
                pathOptions={{ color: '#d946ef', dashArray: '6 6', fill: false, weight: 3 }}
                interactive={false}
              />
            )}
            {pins.map((p) => (
              <Marker
                key={p.scenario.number}
                position={toLatLng(p.x, p.y, size)}
                icon={icon(p.scenario, placeMode && p.scenario.number === selected)}
                title={`${p.scenario.number} ${p.scenario.name}`}
                eventHandlers={placeMode ? { click: () => setSelected(p.scenario.number) } : {}}
              >
                {!placeMode && (
                  <Popup>
                    <div className="flex flex-col gap-1">
                      <strong>
                        {p.scenario.number} · {p.scenario.name}
                      </strong>
                      {p.scenario.coord && <span>{p.scenario.coord}</span>}
                      <span>{t(`map.look.${lookOf(p.scenario)}`)}</span>
                      <Link
                        to="/c/$campaignId/scenarios"
                        params={{ campaignId }}
                        search={{ open: p.scenario.number }}
                        className="underline"
                      >
                        {t('map.open')}
                      </Link>
                    </div>
                  </Popup>
                )}
              </Marker>
            ))}
          </MapContainer>
        </div>
      ) : (
        <p className="text-slate-500">{t('scenarios.none')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" aria-label={t('map.legend')}>
        {(
          [
            'available',
            'blocked',
            'completed',
            'locked_out',
            ...(isHost ? ['locked'] : []),
          ] as Look[]
        ).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`inline-block size-4 rounded-full border-2 ${lookClass[k]}`} />
            {t(`map.look.${k}`)}
          </span>
        ))}
        {isHost && !placeMode && (
          <label className="ml-auto flex min-h-12 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={showLocked}
              onChange={(e) => setShowLocked(e.target.checked)}
            />
            {t('map.showLocked')}
          </label>
        )}
      </div>
      {unplaced > 0 && (
        <p className="mt-2 text-sm text-slate-500">{t('map.unplaced', { n: unplaced })}</p>
      )}
    </>
  );
}
