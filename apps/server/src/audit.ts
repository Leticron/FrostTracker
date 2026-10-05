import { randomUUID } from 'node:crypto';
import type { Tx } from './db/client.ts';
import { auditEntries } from './db/schema.ts';

export interface AuditInput {
  campaignId?: string | null;
  characterId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
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
      before: e.before ?? null,
      after: e.after ?? null,
    })),
  );
  return groupId;
}
