import { authRouter } from '../routers/auth.ts';
import { adminRouter } from '../routers/admin.ts';
import { campaignRouter } from '../routers/campaign.ts';
import { characterRouter } from '../routers/character.ts';
import { mapRouter } from '../routers/map.ts';
import { outpostRouter } from '../routers/outpost.ts';
import { scenarioRouter, sectionRouter } from '../routers/scenario.ts';
import { sessionRouter } from '../routers/session.ts';
import { stateRouter } from '../routers/state.ts';
import { router } from './trpc.ts';

export const appRouter = router({
  auth: authRouter,
  campaign: campaignRouter,
  character: characterRouter,
  admin: adminRouter,
  state: stateRouter,
  scenario: scenarioRouter,
  section: sectionRouter,
  session: sessionRouter,
  outpost: outpostRouter,
  map: mapRouter,
});

export type AppRouter = typeof appRouter;
