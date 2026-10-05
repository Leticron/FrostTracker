import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { AppShell } from './components/AppShell.tsx';
import { Placeholder } from './components/Placeholder.tsx';
import i18n from './i18n/index.ts';
import { JoinPage, LoginPage, RegisterPage } from './routes/auth.tsx';
import {
  CampaignDashboard,
  CampaignLayout,
  CampaignListPage,
  NewCampaignPage,
} from './routes/campaigns.tsx';
import { CharacterHistoryPage, CharacterPage } from './routes/character.tsx';
import { MembersPage } from './routes/members.tsx';
import { NewCharacterPage, PartyPage } from './routes/party.tsx';
import { AdminPage, ClassEditorPage, SettingsPage } from './routes/settings.tsx';
import { ProfilePage } from './routes/profile.tsx';
import { queryClient, trpc } from './trpc.ts';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
});

const fetchMe = () => queryClient.fetchQuery({ ...trpc.auth.me.queryOptions(), staleTime: 5_000 });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s.redirect === 'string' ? { redirect: s.redirect } : {},
  beforeLoad: async () => {
    if ((await fetchMe()).user) throw redirect({ to: '/' });
  },
  component: function Login() {
    const { redirect: to } = loginRoute.useSearch();
    return <LoginPage redirect={to} />;
  },
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  beforeLoad: async () => {
    const me = await fetchMe();
    if (me.user) throw redirect({ to: '/' });
    if (!me.registrationOpen) throw redirect({ to: '/login' });
  },
  component: RegisterPage,
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$code',
  component: function Join() {
    const { code } = joinRoute.useParams();
    return <JoinPage code={code} />;
  },
});

/** Everything below requires a signed-in user. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ location }) => {
    const me = await fetchMe();
    if (!me.user) throw redirect({ to: '/login', search: { redirect: location.href } });
    return { user: me.user };
  },
  component: AppShell,
});

const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: CampaignListPage,
});

const newCampaignRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaigns/new',
  component: NewCampaignPage,
});

const profileRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/profile',
  component: ProfilePage,
});

const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/admin',
  beforeLoad: ({ context }) => {
    if (!context.user.isSiteAdmin) throw redirect({ to: '/' });
  },
  component: AdminPage,
});

const campaignRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/c/$campaignId',
  component: function Campaign() {
    const { campaignId } = campaignRoute.useParams();
    return <CampaignLayout campaignId={campaignId} />;
  },
});

const campaignIndexRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: '/',
  component: function Dashboard() {
    const { campaignId } = campaignRoute.useParams();
    return <CampaignDashboard campaignId={campaignId} />;
  },
});

const membersRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: '/members',
  component: function Members() {
    const { campaignId } = campaignRoute.useParams();
    return <MembersPage campaignId={campaignId} />;
  },
});

function campaignPage<const P extends string>(
  path: P,
  render: (campaignId: string) => React.ReactNode,
) {
  return createRoute({
    getParentRoute: () => campaignRoute,
    path,
    component: function CampaignPage() {
      const { campaignId } = campaignRoute.useParams();
      return render(campaignId);
    },
  });
}

const partyRoute = campaignPage('/party', (id) => <PartyPage campaignId={id} />);
const newCharacterRoute = campaignPage('/characters/new', (id) => (
  <NewCharacterPage campaignId={id} />
));
const characterRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: '/characters/$characterId',
  component: function Character() {
    const { campaignId, characterId } = characterRoute.useParams();
    return <CharacterPage key={characterId} campaignId={campaignId} characterId={characterId} />;
  },
});
const characterHistoryRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: '/characters/$characterId/history',
  component: function CharacterHistory() {
    const { characterId } = characterHistoryRoute.useParams();
    return <CharacterHistoryPage characterId={characterId} />;
  },
});
const settingsRoute = campaignPage('/settings', (id) => <SettingsPage campaignId={id} />);
const classEditorRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: '/settings/classes/$classKey',
  component: function ClassEditor() {
    const { campaignId, classKey } = classEditorRoute.useParams();
    return <ClassEditorPage campaignId={campaignId} classKey={classKey} />;
  },
});

const placeholderTabs = ['scenarios', 'map', 'sessions', 'outpost', 'history'] as const;
const tabKey = { history: 'audit' } as Record<string, string>;
const placeholderRoutes = placeholderTabs.map((tab) =>
  createRoute({
    getParentRoute: () => campaignRoute,
    path: `/${tab}`,
    component: () => (
      <Placeholder title={i18n.t(`campaign.${tabKey[tab] ?? tab}` as 'campaign.map')} />
    ),
  }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  joinRoute,
  authedRoute.addChildren([
    homeRoute,
    newCampaignRoute,
    profileRoute,
    adminRoute,
    campaignRoute.addChildren([
      campaignIndexRoute,
      membersRoute,
      partyRoute,
      newCharacterRoute,
      characterRoute,
      characterHistoryRoute,
      settingsRoute,
      classEditorRoute,
      ...placeholderRoutes,
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
