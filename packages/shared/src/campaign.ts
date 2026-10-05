import { z } from 'zod';

export const campaignRole = z.enum(['host', 'player']);
export type CampaignRole = z.infer<typeof campaignRole>;

export const createCampaignInput = z.object({
  name: z.string().trim().min(1).max(80),
  partyName: z.string().trim().max(80).optional(),
});

export const campaignIdInput = z.object({ campaignId: z.uuid() });

export const createInviteInput = z.object({
  campaignId: z.uuid(),
  role: campaignRole.default('player'),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  maxUses: z.number().int().min(1).max(50).default(1),
});

export const acceptInviteInput = z.object({ code: z.string().trim().min(1).max(128) });

export const setMemberRoleInput = z.object({
  campaignId: z.uuid(),
  userId: z.uuid(),
  role: campaignRole,
});
