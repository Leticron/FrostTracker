import { authRouter } from '../routers/auth.ts';
import { adminRouter } from '../routers/admin.ts';
import { campaignRouter } from '../routers/campaign.ts';
import { characterRouter } from '../routers/character.ts';
import { router } from './trpc.ts';

export const appRouter = router({
  auth: authRouter,
  campaign: campaignRouter,
  character: characterRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
