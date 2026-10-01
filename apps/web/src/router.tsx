import { ArrowClockwiseIcon, PlugsIcon } from "@phosphor-icons/react";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  useRouter,
  type ParsedLocation,
} from "@tanstack/react-router";

import { AppShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";
import { meQuery, setupStatusQuery } from "@/lib/queries";
import { ALL_NAV, type AppPath } from "@/nav";
import type { Me } from "@/lib/types";
import { NotFoundPage, PlaceholderPage } from "@/pages/placeholder";

// Each page is its own chunk: the shell loads first, pages load on demand.
const page = {
  setup: lazyRouteComponent(() => import("@/pages/auth"), "SetupPage"),
  login: lazyRouteComponent(() => import("@/pages/auth"), "LoginPage"),
  changePassword: lazyRouteComponent(() => import("@/pages/auth"), "ChangePasswordPage"),
  home: lazyRouteComponent(() => import("@/pages/command-center"), "CommandCenterPage"),
  organization: lazyRouteComponent(() => import("@/pages/organization"), "OrganizationPage"),
  settings: lazyRouteComponent(() => import("@/pages/settings"), "SettingsPage"),
  members: lazyRouteComponent(() => import("@/pages/members"), "MembersPage"),
  activity: lazyRouteComponent(() => import("@/pages/activity"), "ActivityPage"),
  aiEngine: lazyRouteComponent(() => import("@/pages/ai-engine"), "AIEnginePage"),
  agents: lazyRouteComponent(() => import("@/pages/agents/roster"), "AgentsPage"),
  agentNew: lazyRouteComponent(() => import("@/pages/agents/builder"), "AgentBuilderPage"),
  agentDetail: lazyRouteComponent(() => import("@/pages/agents/detail"), "AgentDetailPage"),
  tasks: lazyRouteComponent(() => import("@/pages/tasks/board"), "TasksPage"),
  approvals: lazyRouteComponent(() => import("@/pages/approvals"), "ApprovalsPage"),
  broadcasts: lazyRouteComponent(() => import("@/pages/broadcasts"), "BroadcastsPage"),
  chat: lazyRouteComponent(() => import("@/pages/chat"), "ChatPage"),
  sops: lazyRouteComponent(() => import("@/pages/sops"), "SopsPage"),
  brain: lazyRouteComponent(() => import("@/pages/brain"), "BrainPage"),
  skills: lazyRouteComponent(() => import("@/pages/skills"), "SkillsPage"),
  office: lazyRouteComponent(() => import("@/pages/office"), "OfficePage"),
  channels: lazyRouteComponent(() => import("@/pages/channels"), "ChannelsPage"),
  approve: lazyRouteComponent(() => import("@/pages/approve"), "ApprovePage"),
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (v ? Number(v) : undefined);

const AI_TABS = ["providers", "groups", "usage", "playground"] as const;

interface RouterContext {
  queryClient: QueryClient;
}

function RootError({ error }: { error: unknown }) {
  const router = useRouter();
  const offline = error instanceof ApiError && error.code === "network";
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm">
        <PlugsIcon size={32} weight="duotone" className="text-danger" />
        <h1 className="mt-3 text-lg font-semibold">{offline ? "The server is not answering" : "This page failed to load"}</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {offline ? "Start the stack with docker compose up -d, then try again." : errorMessage(error)}
        </p>
        <Button className="mt-5" onClick={() => router.invalidate()}>
          <ArrowClockwiseIcon size={16} /> Try again
        </Button>
      </div>
    </div>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RootError,
  notFoundComponent: NotFoundPage,
});

async function loadMe(qc: QueryClient, location: ParsedLocation): Promise<Me> {
  try {
    return await qc.ensureQueryData(meQuery);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const setup = await qc.fetchQuery(setupStatusQuery).catch(() => null);
      if (setup?.needs_setup) throw redirect({ to: "/setup" });
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    throw e;
  }
}

async function alreadySignedIn(qc: QueryClient): Promise<Me | null> {
  try {
    return await qc.ensureQueryData(meQuery);
  } catch {
    return null;
  }
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.fetchQuery(setupStatusQuery);
    if (!s.needs_setup) throw redirect({ to: "/login" });
  },
  component: page.setup,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  beforeLoad: async ({ context }) => {
    if (await alreadySignedIn(context.queryClient)) throw redirect({ to: "/" });
    const s = await context.queryClient.fetchQuery(setupStatusQuery).catch(() => null);
    if (s?.needs_setup) throw redirect({ to: "/setup" });
  },
  component: page.login,
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/change-password",
  beforeLoad: async ({ context, location }) => {
    await loadMe(context.queryClient, location);
  },
  component: page.changePassword,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient, location);
    if (me.user.must_change_password) throw redirect({ to: "/change-password" });
    return { me };
  },
  component: AppShell,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: page.home });

const organizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/organization",
  validateSearch: (s: Record<string, unknown>): { new?: number } => ({ new: s.new ? Number(s.new) : undefined }),
  component: page.organization,
});

const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings", component: page.settings });

const membersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/members",
  validateSearch: (s: Record<string, unknown>): { add?: number } => ({ add: s.add ? Number(s.add) : undefined }),
  component: page.members,
});

const activityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activity",
  beforeLoad: ({ context }) => {
    if (!context.me.permissions.includes("audit.read")) throw redirect({ to: "/" });
  },
  component: page.activity,
});

const aiEngineRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/ai-engine",
  validateSearch: (s: Record<string, unknown>): { tab?: (typeof AI_TABS)[number] } => ({
    tab: AI_TABS.find((t) => t === s.tab),
  }),
  component: page.aiEngine,
});

const agentsRoute = createRoute({ getParentRoute: () => appRoute, path: "/agents", component: page.agents });
const agentNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents/new",
  beforeLoad: ({ context }) => {
    if (!context.me.permissions.includes("org.manage")) throw redirect({ to: "/agents" });
  },
  component: page.agentNew,
});
const agentDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents/$agentId",
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }),
  component: page.agentDetail,
});
const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  validateSearch: (s: Record<string, unknown>): { task?: string; new?: number; agent?: string; brief?: string } => ({
    task: str(s.task), new: num(s.new), agent: str(s.agent), brief: str(s.brief),
  }),
  component: page.tasks,
});
const approvalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/approvals",
  validateSearch: (s: Record<string, unknown>): { tab?: "pending" | "history" } => ({ tab: s.tab === "history" ? "history" : undefined }),
  component: page.approvals,
});
const broadcastsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/broadcasts",
  validateSearch: (s: Record<string, unknown>): { b?: string } => ({ b: str(s.b) }),
  component: page.broadcasts,
});
const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chat",
  validateSearch: (s: Record<string, unknown>): { agent?: string } => ({ agent: str(s.agent) }),
  component: page.chat,
});
const sopsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sops",
  validateSearch: (s: Record<string, unknown>): { sop?: string } => ({ sop: str(s.sop) }),
  component: page.sops,
});

const BRAIN_TABS = ["pages", "facts", "search", "graph", "dreams"] as const;
const brainRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/brain",
  validateSearch: (s: Record<string, unknown>): { tab?: (typeof BRAIN_TABS)[number]; path?: string; dream?: string; q?: string } => ({
    tab: BRAIN_TABS.find((t) => t === s.tab),
    path: str(s.path),
    dream: str(s.dream),
    q: str(s.q),
  }),
  component: page.brain,
});

const channelsRoute = createRoute({ getParentRoute: () => appRoute, path: "/channels", component: page.channels });
const approveRoute = createRoute({ getParentRoute: () => appRoute, path: "/approve/$approvalId", component: page.approve });

const officeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/office",
  validateSearch: (s: Record<string, unknown>): { agent?: string; view?: "map" | "list" } => ({
    agent: str(s.agent),
    view: s.view === "list" ? "list" : undefined,
  }),
  component: page.office,
});

const SKILL_TABS = ["library", "proposals", "history"] as const;
const skillsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/skills",
  validateSearch: (s: Record<string, unknown>): { tab?: (typeof SKILL_TABS)[number]; skill?: string; proposal?: string } => ({
    tab: SKILL_TABS.find((t) => t === s.tab),
    skill: str(s.skill),
    proposal: str(s.proposal),
  }),
  component: page.skills,
});

function placeholder<P extends AppPath>(path: P) {
  const item = ALL_NAV.find((n) => n.to === path)!;
  return createRoute({
    getParentRoute: () => appRoute,
    path,
    component: () => <PlaceholderPage item={item} />,
  });
}

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  changePasswordRoute,
  appRoute.addChildren([
    homeRoute,
    organizationRoute,
    settingsRoute,
    membersRoute,
    activityRoute,
    aiEngineRoute,
    agentsRoute,
    agentNewRoute,
    agentDetailRoute,
    tasksRoute,
    approvalsRoute,
    broadcastsRoute,
    chatRoute,
    sopsRoute,
    brainRoute,
    skillsRoute,
    officeRoute,
    channelsRoute,
    approveRoute,
    placeholder("/meetings"),
    placeholder("/schedules"),
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
