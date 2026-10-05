import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  addItemInput,
  adjustCharacterInput,
  campaignIdInput,
  characterIdInput,
  createCharacterInput,
  levelUpInput,
  revertInput,
  sellItemInput,
  setMasteryInput,
  setPerkMarksInput,
  statusChangeInput,
  transferToSupplyInput,
  updateCharacterInput,
  type ResourceBag,
  type RuleTables,
} from '@fht/shared';
import {
  applyCheckmarkChange,
  applyProsperityChange,
  maxHitPoints,
  perkMarksAvailable,
  perkMarksEarned,
  perkMarksSpent,
  prosperityLevel,
  prosperityLevelCap,
  prosperityLevelUp,
  sellPrice,
  startingGold,
  xpForLevel,
  xpLevelUpDue,
} from '@fht/rules';
import { diff, revertGroup, RevertConflict, writeAudit, type AuditInput } from '../audit.ts';
import type { Tx } from '../db/client.ts';
import {
  auditEntries,
  campaignMembers,
  campaigns,
  characterItems,
  characters,
  itemDefs,
  personalQuestDefs,
  users,
} from '../db/schema.ts';
import { availableClassKeys, campaignData, classDef } from '../services/campaign-data.ts';
import type { Context } from '../trpc/context.ts';
import { authedProcedure, requireMembership, router } from '../trpc/trpc.ts';

type Character = typeof characters.$inferSelect;
type AuthedCtx = Context & { user: NonNullable<Context['user']> };

const editableFields = [
  'name',
  'status',
  'level',
  'xp',
  'gold',
  'resources',
  'checkmarks',
  'perkMarks',
  'masteries',
  'personalQuestNumber',
  'personalQuestText',
  'personalQuestProgress',
  'notes',
  'retiredAt',
] as const satisfies (keyof Character)[];

/** Loads a character and checks access: members may read; owner or host may edit. */
async function access(
  ctx: AuthedCtx,
  db: Context['db'] | Tx,
  characterId: string,
  edit: boolean,
  lock = false,
) {
  const q = db.select().from(characters).where(eq(characters.id, characterId));
  const [character] = lock ? await q.for('update') : await q;
  if (!character) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
  const { role } = await requireMembership({ db, user: ctx.user }, character.campaignId);
  const canEdit = role === 'host' || character.ownerUserId === ctx.user.id;
  if (edit && !canEdit) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the owner or a host can change this character',
    });
  }
  if (edit && !['active', 'set_aside'].includes(character.status)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Retired or abandoned characters are read-only',
    });
  }
  return { character, role, canEdit };
}

/** Applies a change to a character inside a transaction and audits the changed fields. */
async function saveCharacter(
  tx: Tx,
  ctx: AuthedCtx,
  before: Character,
  changes: Partial<Character>,
  action: string,
  extra: AuditInput[] = [],
) {
  const [after] = await tx
    .update(characters)
    .set({ ...changes, version: before.version + 1 })
    .where(eq(characters.id, before.id))
    .returning();
  const d = diff(before, after!, [...editableFields]);
  const entries: AuditInput[] = [];
  if (d) {
    entries.push({
      campaignId: before.campaignId,
      characterId: before.id,
      entity: 'character',
      entityId: before.id,
      action,
      before: d.before,
      after: d.after,
    });
  }
  await writeAudit(tx, ctx.user.id, [...entries, ...extra]);
  return after!;
}

function progress(c: Character) {
  return {
    level: c.level,
    xp: c.xp,
    checkmarks: c.checkmarks,
    bonusPerkMarks: c.bonusPerkMarks,
    perkMarks: c.perkMarks,
    masteries: c.masteries,
  };
}

function addBags(a: ResourceBag, b: ResourceBag): ResourceBag {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (v) out[k] = (out[k] ?? 0) + v;
  return out;
}

function assertResourceKey(rules: RuleTables, key: string) {
  if (!rules.resources.some((r) => r.key === key)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown resource "${key}"` });
  }
}

/**
 * Moves a character's resources into the campaign supply and returns the audit entry for the
 * campaign row. RULE: R-CHAR-10, R-CHAR-19, R-CHAR-20
 */
async function moveToSupply(
  tx: Tx,
  campaignId: string,
  characterId: string,
  bag: ResourceBag,
  extraCampaign: Partial<typeof campaigns.$inferSelect> = {},
): Promise<AuditInput> {
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for('update');
  const changes = { supply: addBags(c!.supply, bag), ...extraCampaign };
  const [after] = await tx
    .update(campaigns)
    .set({ ...changes, version: c!.version + 1 })
    .where(eq(campaigns.id, campaignId))
    .returning();
  const d = diff(c!, after!, ['supply', 'prosperityChecks']);
  return {
    campaignId,
    characterId,
    entity: 'campaign',
    entityId: campaignId,
    action: 'character_to_supply',
    before: d?.before ?? {},
    after: d?.after ?? {},
  };
}

async function deleteItems(tx: Tx, character: Character): Promise<AuditInput[]> {
  const items = await tx
    .select()
    .from(characterItems)
    .where(eq(characterItems.characterId, character.id));
  if (!items.length) return [];
  await tx.delete(characterItems).where(eq(characterItems.characterId, character.id));
  return items.map((i) => ({
    campaignId: character.campaignId,
    characterId: character.id,
    entity: 'character_item',
    entityId: i.id,
    action: 'return_to_supply',
    before: i,
    after: null,
  }));
}

export const characterRouter = router({
  list: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    return ctx.db
      .select({
        id: characters.id,
        name: characters.name,
        classKey: characters.classKey,
        level: characters.level,
        status: characters.status,
        retiredAt: characters.retiredAt,
        ownerUserId: characters.ownerUserId,
        ownerName: users.displayName,
        updatedAt: characters.updatedAt,
      })
      .from(characters)
      .innerJoin(users, eq(users.id, characters.ownerUserId))
      .where(eq(characters.campaignId, input.campaignId))
      .orderBy(desc(characters.updatedAt));
  }),

  /** Classes for the character creation picker, with availability. */
  classes: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    const { dataSetId, rules, campaign } = await campaignData(ctx.db, input.campaignId);
    const classes = await availableClassKeys(ctx.db, input.campaignId, dataSetId);
    const occupied = await ctx.db
      .select({ classKey: characters.classKey })
      .from(characters)
      .where(
        and(
          eq(characters.campaignId, input.campaignId),
          inArray(characters.status, ['active', 'set_aside']),
        ),
      );
    const taken = new Set(occupied.map((o) => o.classKey));
    const prosperity = prosperityLevel(campaign.prosperityChecks, rules.prosperity);
    return {
      dataSetId,
      prosperity,
      startingGold: startingGold(prosperity, rules.startingGold),
      maxStartLevel: Math.max(1, prosperityLevelCap(prosperity)),
      classes: classes.map((c) => ({
        key: c.key,
        name: c.name,
        starting: c.starting,
        available: c.available,
        taken: taken.has(c.key),
      })),
    };
  }),

  get: authedProcedure.input(characterIdInput).query(async ({ ctx, input }) => {
    const { character, canEdit, role } = await access(ctx, ctx.db, input.characterId, false);
    const { rules, dataSetId, campaign } = await campaignData(ctx.db, character.campaignId);
    const cls = await classDef(ctx.db, dataSetId, character.classKey);
    const items = await ctx.db
      .select()
      .from(characterItems)
      .where(eq(characterItems.characterId, character.id))
      .orderBy(characterItems.createdAt);
    const [owner] = await ctx.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, character.ownerUserId));
    const pq = character.personalQuestNumber
      ? (
          await ctx.db
            .select()
            .from(personalQuestDefs)
            .where(
              and(
                eq(personalQuestDefs.dataSetId, dataSetId),
                eq(personalQuestDefs.number, character.personalQuestNumber),
              ),
            )
        )[0]
      : undefined;
    const p = progress(character);
    const prosperity = prosperityLevel(campaign.prosperityChecks, rules.prosperity);
    return {
      character,
      ownerName: owner?.displayName ?? '',
      canEdit: canEdit && ['active', 'set_aside'].includes(character.status),
      isHost: role === 'host',
      classDef: cls,
      items,
      personalQuest: pq ?? null,
      rules: {
        resources: rules.resources,
        xpThresholds: rules.levels.xpThresholds,
        checkmarksMax: rules.checkmarks.max,
        checkmarksPerPerkMark: rules.checkmarks.perPerkMark,
      },
      derived: {
        nextLevelXp: xpForLevel(character.level + 1, rules.levels) ?? null,
        levelUpDue: xpLevelUpDue(character, rules.levels),
        prosperity,
        prosperityLevelUpAvailable:
          prosperityLevelUp(character, prosperityLevelCap(prosperity), rules.levels) !== null,
        perkMarksEarned: perkMarksEarned(p, rules.checkmarks),
        perkMarksSpent: perkMarksSpent(p),
        perkMarksAvailable: perkMarksAvailable(p, rules.checkmarks),
        maxHp: cls ? maxHitPoints(cls, character.level) : null,
      },
    };
  }),

  create: authedProcedure.input(createCharacterInput).mutation(async ({ ctx, input }) => {
    const { role } = await requireMembership(ctx, input.campaignId);
    const ownerUserId = input.ownerUserId ?? ctx.user.id;
    if (ownerUserId !== ctx.user.id) {
      if (role !== 'host')
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only hosts can create characters for others',
        });
      await requireMembership({ db: ctx.db, user: { id: ownerUserId } }, input.campaignId);
    }
    return ctx.db.transaction(async (tx) => {
      const { rules, dataSetId, campaign } = await campaignData(tx, input.campaignId);
      const classes = await availableClassKeys(tx, input.campaignId, dataSetId);
      const cls = classes.find((c) => c.key === input.classKey);
      // RULE: R-CHAR-22 - only starting or unlocked classes.
      if (!cls?.available)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This class is not available' });
      const prosperity = prosperityLevel(campaign.prosperityChecks, rules.prosperity);
      // RULE: R-CHAR-21 - start at level 1, optionally up to half the prosperity level (rounded up).
      const cap = Math.max(1, prosperityLevelCap(prosperity));
      if (input.startLevel > cap) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Start level can be at most ${cap}` });
      }
      // RULE: R-CHAR-12 - one bonus perk mark per character this player retired before.
      const [{ n: retired } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(characters)
        .where(
          and(
            eq(characters.campaignId, input.campaignId),
            eq(characters.ownerUserId, ownerUserId),
            eq(characters.status, 'retired'),
          ),
        );
      let inserted;
      try {
        [inserted] = await tx
          .insert(characters)
          .values({
            campaignId: input.campaignId,
            ownerUserId,
            classKey: cls.key,
            name: input.name,
            level: input.startLevel,
            xp: xpForLevel(input.startLevel, rules.levels) ?? 0,
            gold: startingGold(prosperity, rules.startingGold),
            bonusPerkMarks: retired,
            perkMarks: cls.perks.map(() => 0),
            masteries: cls.masteries.map(() => false),
          })
          .returning();
      } catch (err) {
        if (
          (err as { cause?: { code?: string } }).cause?.code === '23505' ||
          (err as { code?: string }).code === '23505'
        ) {
          // RULE: R-CHAR-02
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'There is already a character of this class',
          });
        }
        throw err;
      }
      await writeAudit(tx, ctx.user.id, [
        {
          campaignId: input.campaignId,
          characterId: inserted!.id,
          entity: 'character',
          entityId: inserted!.id,
          action: 'create',
          before: null,
          after: inserted,
        },
      ]);
      return { id: inserted!.id };
    });
  }),

  /** +/- counters. Values never go below zero; checkmarks follow their own rule. */
  adjust: authedProcedure.input(adjustCharacterInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { rules } = await campaignData(tx, character.campaignId);
      let changes: Partial<Character>;
      if (input.field === 'checkmarks') {
        // RULE: R-CHAR-11
        changes = {
          checkmarks: applyCheckmarkChange(character.checkmarks, input.delta, rules.checkmarks),
        };
      } else if (input.field === 'xp' || input.field === 'gold') {
        changes = { [input.field]: Math.max(0, character[input.field] + input.delta) };
      } else {
        const key = input.field.slice('resource:'.length);
        assertResourceKey(rules, key);
        const value = Math.max(0, (character.resources[key] ?? 0) + input.delta);
        changes = { resources: { ...character.resources, [key]: value } };
      }
      const after = await saveCharacter(tx, ctx, character, changes, `adjust_${input.field}`);
      return { character: after };
    }),
  ),

  update: authedProcedure.input(updateCharacterInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { characterId: _id, ...changes } = input;
      const after = await saveCharacter(tx, ctx, character, changes, 'update');
      return { character: after };
    }),
  ),

  levelUp: authedProcedure.input(levelUpInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { rules, campaign } = await campaignData(tx, character.campaignId);
      let changes: Partial<Character>;
      if (input.mode === 'xp') {
        // RULE: R-CHAR-04 - XP stays a running total.
        if (!xpLevelUpDue(character, rules.levels)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Not enough experience for the next level',
          });
        }
        changes = { level: character.level + 1 };
      } else {
        // RULE: R-CHAR-05
        const cap = prosperityLevelCap(
          prosperityLevel(campaign.prosperityChecks, rules.prosperity),
        );
        const up = prosperityLevelUp(character, cap, rules.levels);
        if (!up)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Prosperity does not allow a higher level',
          });
        changes = up;
      }
      const after = await saveCharacter(tx, ctx, character, changes, `level_up_${input.mode}`);
      return { character: after };
    }),
  ),

  setPerkMarks: authedProcedure.input(setPerkMarksInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { rules, dataSetId } = await campaignData(tx, character.campaignId);
      const cls = await classDef(tx, dataSetId, character.classKey);
      const perk = cls?.perks[input.perkIndex];
      if (!perk) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown perk' });
      if (input.marked > perk.boxes)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'More marks than boxes' });
      const perkMarks = cls!.perks.map((_, i) =>
        i === input.perkIndex ? input.marked : (character.perkMarks[i] ?? 0),
      );
      // RULE: R-CHAR-12, R-CHAR-13 - every marked box costs one earned perk mark.
      if (perkMarksAvailable({ ...progress(character), perkMarks }, rules.checkmarks) < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No perk marks left' });
      }
      const after = await saveCharacter(tx, ctx, character, { perkMarks }, 'set_perk');
      return { character: after };
    }),
  ),

  setMastery: authedProcedure.input(setMasteryInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { rules, dataSetId } = await campaignData(tx, character.campaignId);
      const cls = await classDef(tx, dataSetId, character.classKey);
      const n = Math.max(cls?.masteries.length ?? 0, character.masteries.length);
      if (input.masteryIndex >= n)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown mastery' });
      const masteries = Array.from({ length: n }, (_, i) =>
        i === input.masteryIndex ? input.achieved : (character.masteries[i] ?? false),
      );
      // RULE: R-CHAR-14 - un-marking a mastery must not leave spent perk marks uncovered.
      if (perkMarksAvailable({ ...progress(character), masteries }, rules.checkmarks) < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Remove a perk mark first' });
      }
      const after = await saveCharacter(tx, ctx, character, { masteries }, 'set_mastery');
      return { character: after };
    }),
  ),

  addItem: authedProcedure.input(addItemInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { dataSetId } = await campaignData(tx, character.campaignId);
      let name = input.name;
      if (input.itemNumber !== undefined) {
        const [def] = await tx
          .select()
          .from(itemDefs)
          .where(and(eq(itemDefs.dataSetId, dataSetId), eq(itemDefs.number, input.itemNumber)));
        name = def?.name ?? name ?? `#${input.itemNumber}`;
        // RULE: R-CHAR-15 - only one copy of an item per character.
        const [dup] = await tx
          .select({ id: characterItems.id })
          .from(characterItems)
          .where(
            and(
              eq(characterItems.characterId, character.id),
              eq(characterItems.itemNumber, input.itemNumber),
            ),
          );
        if (dup) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'The character already owns this item; a second copy must be sold right away',
          });
        }
      }
      if (!name)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Item name or number required' });
      const [item] = await tx
        .insert(characterItems)
        .values({ characterId: character.id, itemNumber: input.itemNumber ?? null, name })
        .returning();
      await writeAudit(tx, ctx.user.id, [
        {
          campaignId: character.campaignId,
          characterId: character.id,
          entity: 'character_item',
          entityId: item!.id,
          action: 'add_item',
          before: null,
          after: item,
        },
      ]);
      return { item: item! };
    }),
  ),

  removeItem: authedProcedure
    .input(sellItemInput.pick({ characterItemId: true }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(characterItems)
          .where(eq(characterItems.id, input.characterItemId));
        if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
        const { character } = await access(ctx, tx, item.characterId, true, true);
        await tx.delete(characterItems).where(eq(characterItems.id, item.id));
        await writeAudit(tx, ctx.user.id, [
          {
            campaignId: character.campaignId,
            characterId: character.id,
            entity: 'character_item',
            entityId: item.id,
            action: 'remove_item',
            before: item,
            after: null,
          },
        ]);
        return { ok: true };
      }),
    ),

  /** RULE: R-CHAR-17 */
  sellItem: authedProcedure.input(sellItemInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(characterItems)
        .where(eq(characterItems.id, input.characterItemId));
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      const { character } = await access(ctx, tx, item.characterId, true, true);
      const { dataSetId } = await campaignData(tx, character.campaignId);
      let gold: number | null = null;
      if (item.itemNumber !== null) {
        const [def] = await tx
          .select()
          .from(itemDefs)
          .where(and(eq(itemDefs.dataSetId, dataSetId), eq(itemDefs.number, item.itemNumber)));
        if (def) gold = sellPrice(def);
      }
      gold ??= input.gold ?? null;
      if (gold === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Sell price unknown for this item; enter the gold received',
        });
      }
      await tx.delete(characterItems).where(eq(characterItems.id, item.id));
      const after = await saveCharacter(
        tx,
        ctx,
        character,
        { gold: character.gold + gold },
        'sell_item',
        [
          {
            campaignId: character.campaignId,
            characterId: character.id,
            entity: 'character_item',
            entityId: item.id,
            action: 'sell_item',
            before: item,
            after: null,
          },
        ],
      );
      return { character: after, gold };
    }),
  ),

  /** One-way: personal supply -> Frosthaven supply. RULE: R-CHAR-10 */
  transferToSupply: authedProcedure.input(transferToSupplyInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { rules } = await campaignData(tx, character.campaignId, true);
      assertResourceKey(rules, input.resourceKey);
      const have = character.resources[input.resourceKey] ?? 0;
      if (input.amount > have)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not enough resources' });
      const campaignEntry = await moveToSupply(tx, character.campaignId, character.id, {
        [input.resourceKey]: input.amount,
      });
      const after = await saveCharacter(
        tx,
        ctx,
        character,
        { resources: { ...character.resources, [input.resourceKey]: have - input.amount } },
        'transfer_to_supply',
        [campaignEntry],
      );
      return { character: after };
    }),
  ),

  /** RULE: R-CHAR-19 (set aside / abandon), R-CHAR-20 (retire) */
  changeStatus: authedProcedure.input(statusChangeInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const { character } = await access(ctx, tx, input.characterId, true, true);
      const { rules } = await campaignData(tx, character.campaignId, true);
      const allowed: Record<typeof input.action, Character['status'][]> = {
        set_aside: ['active'],
        reactivate: ['set_aside'],
        abandon: ['active', 'set_aside'],
        retire: ['active'],
      };
      if (!allowed[input.action].includes(character.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not possible in the current state' });
      }
      if (input.action === 'set_aside' || input.action === 'reactivate') {
        const after = await saveCharacter(
          tx,
          ctx,
          character,
          { status: input.action === 'set_aside' ? 'set_aside' : 'active' },
          input.action,
        );
        return { character: after };
      }
      // Abandon and retire: items go back to the supply, resources to the Frosthaven supply,
      // gold is lost. Retiring also gains prosperity.
      const itemEntries = await deleteItems(tx, character);
      const [camp] = await tx
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, character.campaignId));
      const extra =
        input.action === 'retire'
          ? {
              prosperityChecks: applyProsperityChange(
                camp!.prosperityChecks,
                rules.retirement.prosperityGain,
                rules.prosperity,
              ),
            }
          : {};
      const campaignEntry = await moveToSupply(
        tx,
        character.campaignId,
        character.id,
        character.resources,
        extra,
      );
      const after = await saveCharacter(
        tx,
        ctx,
        character,
        {
          status: input.action === 'retire' ? 'retired' : 'abandoned',
          retiredAt: input.action === 'retire' ? new Date() : null,
          gold: 0,
          resources: {},
          ...(input.action === 'abandon'
            ? { personalQuestNumber: null, personalQuestText: null }
            : {}),
        },
        input.action,
        [campaignEntry, ...itemEntries],
      );
      return { character: after };
    }),
  ),

  history: authedProcedure.input(characterIdInput).query(async ({ ctx, input }) => {
    const { character, canEdit } = await access(ctx, ctx.db, input.characterId, false);
    const rows = await ctx.db
      .select({
        id: auditEntries.id,
        groupId: auditEntries.groupId,
        entity: auditEntries.entity,
        action: auditEntries.action,
        before: auditEntries.before,
        after: auditEntries.after,
        at: auditEntries.at,
        revertedBy: auditEntries.revertedBy,
        actorName: users.displayName,
      })
      .from(auditEntries)
      .leftJoin(users, eq(users.id, auditEntries.actorUserId))
      .where(eq(auditEntries.characterId, character.id))
      .orderBy(desc(auditEntries.at))
      .limit(500);
    return { entries: rows, canRevert: canEdit };
  }),

  /**
   * Reverts one change (an audit group) of a character. Owners can revert changes to their own
   * character; hosts any change in their campaign.
   */
  revert: authedProcedure.input(revertInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const entries = await tx
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.groupId, input.groupId));
      const charIds = [
        ...new Set(entries.map((e) => e.characterId).filter((x): x is string => !!x)),
      ];
      if (!entries.length || charIds.length !== 1 || entries.some((e) => !e.characterId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'History entry not found' });
      }
      const [character] = await tx.select().from(characters).where(eq(characters.id, charIds[0]!));
      if (!character) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
      const { role } = await requireMembership({ db: tx, user: ctx.user }, character.campaignId);
      if (role !== 'host' && character.ownerUserId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the owner or a host can revert this',
        });
      }
      if (entries.some((e) => e.action === 'create')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Character creation cannot be reverted; abandon instead',
        });
      }
      try {
        await revertGroup(tx, input.groupId, ctx.user.id);
      } catch (err) {
        if (err instanceof RevertConflict)
          throw new TRPCError({ code: 'CONFLICT', message: err.message });
        throw err;
      }
      return { ok: true };
    }),
  ),

  /** Retired characters of the campaign (the campaign sheet's retirement table). RULE: R-CAMP-15 */
  retirements: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    return ctx.db
      .select({
        id: characters.id,
        name: characters.name,
        classKey: characters.classKey,
        level: characters.level,
        perkMarks: characters.perkMarks,
        masteries: characters.masteries,
        retiredAt: characters.retiredAt,
        playerName: users.displayName,
      })
      .from(characters)
      .innerJoin(users, eq(users.id, characters.ownerUserId))
      .where(and(eq(characters.campaignId, input.campaignId), eq(characters.status, 'retired')))
      .orderBy(characters.retiredAt);
  }),

  /** Members a host can assign as character owner. */
  owners: authedProcedure.input(campaignIdInput).query(async ({ ctx, input }) => {
    await requireMembership(ctx, input.campaignId);
    return ctx.db
      .select({ userId: users.id, displayName: users.displayName })
      .from(campaignMembers)
      .innerJoin(users, eq(users.id, campaignMembers.userId))
      .where(eq(campaignMembers.campaignId, input.campaignId));
  }),
});
