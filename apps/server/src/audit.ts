import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { asc, eq, getTableColumns, isNull, and } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from './db/client.ts';
import { auditEntries, campaigns, characterItems, characters } from './db/schema.ts';

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
};

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
