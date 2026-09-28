import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
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
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Landing }),
  createRoute({ getParentRoute: () => rootRoute, path: "/battles", component: Battles }),
  createRoute({ getParentRoute: () => rootRoute, path: "/watch/$id", component: Watch }),
  createRoute({ getParentRoute: () => rootRoute, path: "/replay/$id", component: Replay }),
  createRoute({ getParentRoute: () => rootRoute, path: "/record/$id", component: Record }),
  createRoute({ getParentRoute: () => rootRoute, path: "/series/$id/watch", component: SeriesWatch }),
  createRoute({ getParentRoute: () => rootRoute, path: "/series/$id/replay", component: SeriesReplay }),
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
