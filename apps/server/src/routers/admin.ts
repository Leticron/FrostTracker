import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { updateClassInput } from '@fht/shared';
import { z } from 'zod';
import { writeAudit } from '../audit.ts';
import { classDefs, gameDataSets } from '../db/schema.ts';
import { importSeed, readSeedDir, SeedError } from '../services/seed.ts';
import { adminProcedure, authedProcedure, router } from '../trpc/trpc.ts';
import { requireCatalogEditor } from '../services/catalog.ts';

export const adminRouter = router({
  dataSets: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: gameDataSets.id,
        name: gameDataSets.name,
        version: gameDataSets.version,
        importedAt: gameDataSets.importedAt,
      })
      .from(gameDataSets)
      .orderBy(desc(gameDataSets.importedAt)),
  ),

  /** Validates the seed directory without importing it. */
  seedCheck: adminProcedure.query(async ({ ctx }) => {
    try {
      const d = await readSeedDir(ctx.config.SEED_DIR);
      return {
        ok: true as const,
        dir: ctx.config.SEED_DIR,
        manifest: d.manifest,
        counts: {
          classes: d.classes.length,
          items: d.items.length,
          personalQuests: d.personalQuests.length,
        },
      };
    } catch (err) {
      if (err instanceof SeedError)
        return { ok: false as const, dir: ctx.config.SEED_DIR, error: err.message };
      throw err;
    }
  }),

  seedImport: adminProcedure.mutation(async ({ ctx }) => {
    let data;
    try {
      data = await readSeedDir(ctx.config.SEED_DIR);
    } catch (err) {
      if (err instanceof SeedError)
        throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
      throw err;
    }
    const set = await ctx.db.transaction((tx) => importSeed(tx, data, ctx.user.id));
    return { id: set.id, name: set.name, version: set.version };
  }),

  classDef: authedProcedure
    .input(z.object({ dataSetId: z.uuid(), key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireCatalogEditor(ctx, input.dataSetId);
      const [c] = await ctx.db
        .select()
        .from(classDefs)
        .where(and(eq(classDefs.dataSetId, input.dataSetId), eq(classDefs.key, input.key)));
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found' });
      return c;
    }),

  /** Edit a class (perks, masteries, HP) - site admins and campaign hosts (decision P2-3). */
  updateClass: authedProcedure.input(updateClassInput).mutation(async ({ ctx, input }) => {
    await requireCatalogEditor(ctx, input.dataSetId);
    return ctx.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(classDefs)
        .where(and(eq(classDefs.dataSetId, input.dataSetId), eq(classDefs.key, input.key)));
      const values = {
        name: input.name,
        starting: input.starting,
        perks: input.perks,
        masteries: input.masteries,
        maxHpByLevel: input.maxHpByLevel,
        handSize: input.handSize,
      };
      if (before) {
        await tx
          .update(classDefs)
          .set(values)
          .where(and(eq(classDefs.dataSetId, input.dataSetId), eq(classDefs.key, input.key)));
      } else {
        await tx
          .insert(classDefs)
          .values({ ...values, dataSetId: input.dataSetId, key: input.key });
      }
      await writeAudit(tx, ctx.user.id, [
        {
          entity: 'class_def',
          entityId: `${input.dataSetId}:${input.key}`,
          action: before ? 'update' : 'create',
          before: before ?? null,
          after: values,
        },
      ]);
      return { ok: true };
    });
  }),
});
