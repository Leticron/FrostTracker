import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { campaignMembers, invites } from '../db/schema.ts';
import { sha256Hex } from '../auth/session.ts';
import { writeAudit } from '../audit.ts';

export function generateInviteCode(): string {
  // 15 random bytes -> 20 base64url chars; easy to paste, infeasible to guess.
  return randomBytes(15).toString('base64url');
}

/**
 * Redeems an invite for a user inside a transaction: validates it, counts the use and adds
 * the membership. A user who is already a member keeps their role (an invite never demotes).
 */
export async function redeemInvite(
  tx: Tx,
  code: string,
  userId: string,
): Promise<{ campaignId: string; role: 'host' | 'player'; alreadyMember: boolean }> {
  const rows = await tx
    .select()
    .from(invites)
    .where(eq(invites.codeHash, sha256Hex(code)))
    .for('update')
    .limit(1);
  const invite = rows[0];
  if (
    !invite ||
    invite.revokedAt ||
    invite.expiresAt.getTime() <= Date.now() ||
    invite.uses >= invite.maxUses
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite is invalid or expired' });
  }
  const existing = await tx
    .select({ role: campaignMembers.role })
    .from(campaignMembers)
    .where(
      and(eq(campaignMembers.campaignId, invite.campaignId), eq(campaignMembers.userId, userId)),
    )
    .limit(1);
  if (existing[0]) {
    return { campaignId: invite.campaignId, role: existing[0].role, alreadyMember: true };
  }
  await tx
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(eq(invites.id, invite.id));
  await tx
    .insert(campaignMembers)
    .values({ campaignId: invite.campaignId, userId, role: invite.role });
  await writeAudit(tx, userId, [
    {
      campaignId: invite.campaignId,
      entity: 'campaign_member',
      entityId: userId,
      action: 'join_via_invite',
      after: { role: invite.role, inviteId: invite.id },
    },
  ]);
  return { campaignId: invite.campaignId, role: invite.role, alreadyMember: false };
}
