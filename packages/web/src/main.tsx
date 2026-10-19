import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PostHogProvider } from "@posthog/react";
import { initAnalytics, trackError, trackPageview } from "./analytics";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { pages } from "@castellan/shared";
import "./styles.css";
import { DitherDefs } from "./components/DitherDefs";
import { Landing } from "./routes/Landing";
import { Battles } from "./routes/Battles";
import { Watch } from "./routes/Watch";
import { Replay } from "./routes/Replay";
import { Record } from "./routes/Record";
import { SeriesWatch, SeriesReplay } from "./routes/Series";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <DitherDefs />
      <Outlet />
    </>
  ),
});
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: pages.home, component: Landing }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.battles, component: Battles }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.docs, component: lazyRouteComponent(() => import("./routes/Docs"), "Docs") }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.watch, component: Watch }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.replay, component: Replay }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.record, component: Record }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.seriesWatch, component: SeriesWatch }),
  createRoute({ getParentRoute: () => rootRoute, path: pages.seriesReplay, component: SeriesReplay }),
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const analytics = initAnalytics();
router.subscribe("onResolved", trackPageview);
const queryClient = new QueryClient({ queryCache: new QueryCache({
  onError: (_error, query) => trackError("load game data", { resource: String(query.queryKey[0]) }),
}) });

const app = <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {analytics ? <PostHogProvider client={analytics}>{app}</PostHogProvider> : app}
  </StrictMode>,
);
