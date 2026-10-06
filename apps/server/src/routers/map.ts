import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { campaignIdInput, setMarkerInput, type MapLayer, type ScenarioDef } from '@fht/shared';
import { writeAudit } from '../audit.ts';
import { scenarioDefs } from '../db/schema.ts';
import { campaignData } from '../services/campaign-data.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

const layers: MapLayer[] = ['world', 'town'];
const imageTypes = ['webp', 'avif', 'jpg', 'jpeg', 'png'];

/**
 * Finds the owner's map images in ASSETS_DIR (`map/world.<ext>`, `map/town.<ext>`). They are
 * never bundled; without them the web app shows a placeholder grid.
 */
async function findMapImages(dir: string): Promise<Record<MapLayer, string | null>> {
  const out: Record<MapLayer, string | null> = { world: null, town: null };
  for (const layer of layers) {
    for (const ext of imageTypes) {
      const file = `map/${layer}.${ext}`;
      const s = await stat(join(dir, file)).catch(() => null);
      if (s?.isFile()) {
        // The version query lets browsers cache the image until the owner replaces it.
        out[layer] = `/media/${file}?v=${Math.floor(s.mtimeMs)}`;
        break;
      }
    }
  }
  return out;
}

export const mapRouter = router({
  /** Which map images are mounted. Members only, like the files themselves. */
  images: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    return findMapImages(ctx.config.ASSETS_DIR);
  }),

  /**
   * Host "place markers" mode. Markers belong to the campaign's game data set, so every
   * campaign on that data set sees them (decision P2-3). Audited in this campaign's history.
   */
  setMarker: authedProcedure.input(setMarkerInput).mutation(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId, 'host');
    const { dataSetId } = await campaignData(ctx.db, input.campaignId);
    const where = and(
      eq(scenarioDefs.dataSetId, dataSetId),
      eq(scenarioDefs.number, input.scenario),
    );
    return ctx.db.transaction(async (tx) => {
      const [def] = await tx.select().from(scenarioDefs).where(where).for('update');
      if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scenario not found' });
      const after = {
        markerX: input.marker?.x ?? null,
        markerY: input.marker?.y ?? null,
        markerLayer: input.marker?.layer ?? null,
      };
      await tx.update(scenarioDefs).set(after).where(where);
      await writeAudit(tx, ctx.user.id, [
        {
          campaignId: input.campaignId,
          entity: 'scenario_marker',
          entityId: `${dataSetId}:${input.scenario}`,
          action: input.marker ? 'place_marker' : 'remove_marker',
          before: { markerX: def.markerX, markerY: def.markerY, markerLayer: def.markerLayer },
          after,
        },
      ]);
      return { ok: true };
    });
  }),

  /**
   * The data set's scenarios in seed format (`scenarios.json`) including placed markers, so
   * the host can copy them into the seed and keep them across re-imports.
   */
  exportScenarios: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId, 'host');
    const { dataSetId } = await campaignData(ctx.db, input.campaignId);
    const defs = await ctx.db
      .select()
      .from(scenarioDefs)
      .where(eq(scenarioDefs.dataSetId, dataSetId))
      .orderBy(asc(scenarioDefs.number));
    return defs.map((d): ScenarioDef => ({
      number: d.number,
      name: d.name,
      coord: d.coord,
      region: d.region,
      complexity: d.complexity,
      requirements: d.requirements,
      conclusionSections: d.conclusionSections,
      initiallyUnlocked: d.initiallyUnlocked,
      marker:
        d.markerX !== null && d.markerY !== null
          ? { x: d.markerX, y: d.markerY, layer: (d.markerLayer as MapLayer | null) ?? 'world' }
          : null,
    }));
  }),
});
