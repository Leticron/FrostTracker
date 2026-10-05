import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { asc, eq, getTableColumns, isNull, and } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from './db/client.ts';
import {
  auditEntries,
  calendarEntries,
  campaignBuildings,
  campaignClassUnlocks,
  campaigns,
  campaignScenarios,
  campaignStickers,
  characterItems,
  characters,
  eventDeckChanges,
  eventLog,
  playSessions,
  sectionApplications,
  treasuresLooted,
} from './db/schema.ts';

export interface AuditInput {
  campaignId?: string | null;
  characterId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  /** null for inserts; for updates only the changed fields. */
  before?: unknown;
  /** null for deletes; for updates only the changed fields. */
  after?: unknown;
}

/**
 * Writes the audit entries of one user action inside the caller's transaction.
 * All entries share one group id so the action can later be reverted as a unit.
 */
export async function writeAudit(
  tx: Tx,
  actorUserId: string | null,
  entries: AuditInput[],
): Promise<string> {
  const groupId = randomUUID();
  if (entries.length === 0) return groupId;
  await tx.insert(auditEntries).values(
    entries.map((e) => ({
      groupId,
      actorUserId,
      campaignId: e.campaignId ?? null,
      characterId: e.characterId ?? null,
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      before: toJson(e.before ?? null),
      after: toJson(e.after ?? null),
    })),
  );
  return groupId;
}

/** JSON form used for snapshots and comparisons (Dates become ISO strings). */
export function toJson<T>(v: T): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

/** Changed fields between two row versions, as before/after snapshots. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T)[],
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const f of fields) {
    if (JSON.stringify(toJson(before[f])) !== JSON.stringify(toJson(after[f]))) {
      b[f] = before[f];
      a[f] = after[f];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

// Tables whose audit entries can be reverted generically (primary key column `id`).
const revertable: Record<string, { table: PgTable; id: AnyPgColumn }> = {
  character: { table: characters, id: characters.id },
  character_item: { table: characterItems, id: characterItems.id },
  campaign: { table: campaigns, id: campaigns.id },
  campaign_scenario: { table: campaignScenarios, id: campaignScenarios.id },
  campaign_sticker: { table: campaignStickers, id: campaignStickers.id },
  campaign_building: { table: campaignBuildings, id: campaignBuildings.id },
  calendar_entry: { table: calendarEntries, id: calendarEntries.id },
  treasure: { table: treasuresLooted, id: treasuresLooted.id },
  class_unlock: { table: campaignClassUnlocks, id: campaignClassUnlocks.id },
  event_log: { table: eventLog, id: eventLog.id },
  event_deck_change: { table: eventDeckChanges, id: eventDeckChanges.id },
  play_session: { table: playSessions, id: playSessions.id },
  section_application: { table: sectionApplications, id: sectionApplications.id },
};

/**
 * Collects audit entries for one user action while rows are written through it, so every
 * change can be reverted generically. Call `flush` once at the end (inside the transaction).
 */
export class AuditRecorder {
  readonly entries: AuditInput[] = [];
  private readonly tx: Tx;
  private readonly campaignId: string;
  private readonly characterId: string | null;

  constructor(tx: Tx, campaignId: string, characterId: string | null = null) {
    this.tx = tx;
    this.campaignId = campaignId;
    this.characterId = characterId;
  }

  private meta(entity: string, entityId: string, action: string, characterId?: string | null) {
    return {
      campaignId: this.campaignId,
      characterId: characterId === undefined ? this.characterId : characterId,
      entity,
      entityId,
      action,
    };
  }

  async insert<T extends PgTable & { id: AnyPgColumn }>(
    entity: string,
    table: T,
    values: T['$inferInsert'],
    action: string,
    characterId?: string | null,
  ): Promise<T['$inferSelect']> {
    const [row] = (await this.tx
      .insert(table)
      .values(values as never)
      .returning()) as T['$inferSelect'][];
    const r = row as Record<string, unknown>;
    this.entries.push({
      ...this.meta(entity, String(r.id), action, characterId),
      before: null,
      after: row,
    });
    return row!;
  }

  async update<T extends PgTable & { id: AnyPgColumn }>(
    entity: string,
    table: T,
    before: T['$inferSelect'],
    changes: Partial<T['$inferInsert']>,
    action: string,
    characterId?: string | null,
  ): Promise<T['$inferSelect']> {
    const b = before as Record<string, unknown>;
    const [row] = (await this.tx
      .update(table)
      .set(changes as never)
      .where(eq(table.id, b.id))
      .returning()) as T['$inferSelect'][];
    const keys = Object.keys(changes).filter((k) => k !== 'version' && k !== 'updatedAt');
    const d = diff(b, row as Record<string, unknown>, keys);
    if (d)
      this.entries.push({
        ...this.meta(entity, String(b.id), action, characterId),
        before: d.before,
        after: d.after,
      });
    return row!;
  }

  async delete<T extends PgTable & { id: AnyPgColumn }>(
    entity: string,
    table: T,
    before: T['$inferSelect'],
    action: string,
    characterId?: string | null,
  ) {
    const b = before as Record<string, unknown>;
    await this.tx.delete(table).where(eq(table.id, b.id));
    this.entries.push({
      ...this.meta(entity, String(b.id), action, characterId),
      before,
      after: null,
    });
  }

  /** Informational entry (e.g. what a section asked the host to do by hand); skipped on revert. */
  note(action: string, after: unknown) {
    this.entries.push({ ...this.meta('note', this.campaignId, action), before: null, after });
  }

  flush(actorUserId: string): Promise<string> {
    return writeAudit(this.tx, actorUserId, this.entries);
  }
}

export class RevertConflict extends Error {}

/**
 * Reverts all entries of an audit group (newest first). Each entry is only undone if the
 * current row still matches what the entry wrote; otherwise the whole revert is rolled back
 * so nothing is half-undone. The revert itself is audited and the group marked as reverted.
 */
export async function revertGroup(tx: Tx, groupId: string, actorUserId: string) {
  const entries = await tx
    .select()
    .from(auditEntries)
    .where(eq(auditEntries.groupId, groupId))
    .orderBy(asc(auditEntries.at));
  if (!entries.length)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'History entry not found' });
  if (entries.some((e) => e.revertedBy)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This change was already reverted' });
  }
  const undo: AuditInput[] = [];
  for (const e of [...entries].reverse()) {
    if (e.entity === 'note') continue;
    const reg = revertable[e.entity];
    if (!reg) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Changes of type "${e.entity}" cannot be reverted`,
      });
    }
    const { table, id } = reg;
    const cols = getTableColumns(table);
    const rows = await tx.select().from(table).where(eq(id, e.entityId)).for('update');
    const current = rows[0] as Record<string, unknown> | undefined;
    const before = e.before as Record<string, unknown> | null;
    const after = e.after as Record<string, unknown> | null;

    if (before === null && after !== null) {
      // insert -> delete
      if (!current) continue;
      await tx.delete(table).where(eq(id, e.entityId));
      undo.push({ ...meta(e), action: `revert_${e.action}`, before: current, after: null });
    } else if (after === null && before !== null) {
      // delete -> re-insert
      if (current) throw new RevertConflict('The deleted record exists again');
      await tx.insert(table).values(fromJson(before, cols) as never);
      undo.push({ ...meta(e), action: `revert_${e.action}`, before: null, after: before });
    } else if (before && after) {
      if (!current) throw new RevertConflict('The record no longer exists');
      for (const [k, v] of Object.entries(after)) {
        if (JSON.stringify(toJson(current[k])) !== JSON.stringify(v)) {
          throw new RevertConflict(`"${k}" was changed again since; revert the later change first`);
        }
      }
      await tx
        .update(table)
        .set(fromJson(before, cols) as never)
        .where(eq(id, e.entityId));
      undo.push({ ...meta(e), action: `revert_${e.action}`, before: after, after: before });
    }
  }
  const revertGroupId = await writeAudit(tx, actorUserId, undo);
  await tx
    .update(auditEntries)
    .set({ revertedBy: revertGroupId })
    .where(and(eq(auditEntries.groupId, groupId), isNull(auditEntries.revertedBy)));
  return revertGroupId;
}

function meta(e: typeof auditEntries.$inferSelect) {
  return {
    campaignId: e.campaignId,
    characterId: e.characterId,
    entity: e.entity,
    entityId: e.entityId,
  };
}

/** Converts a JSON snapshot back to column values (ISO strings -> Date for timestamps). */
function fromJson(snapshot: Record<string, unknown>, cols: Record<string, { dataType: string }>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    const col = cols[k];
    if (!col) continue;
    out[k] = col.dataType === 'date' && typeof v === 'string' ? new Date(v) : v;
  }
  return out;
}
