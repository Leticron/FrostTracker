import { authRouter } from '../routers/auth.ts';
import { campaignRouter } from '../routers/campaign.ts';
import { router } from './trpc.ts';

export const appRouter = router({
  auth: authRouter,
  campaign: campaignRouter,
});

export type AppRouter = typeof appRouter;
