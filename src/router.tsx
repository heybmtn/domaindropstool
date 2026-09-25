import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/ui";
import { DashboardPage } from "./pages/DashboardPage";

/** The dashboard loads eagerly; other pages are code-split. */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    hydrateFallbackElement: <LoadingState />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "drop-lists", lazy: () => import("./pages/DropListsPage").then((m) => ({ Component: m.DropListsPage })) },
      { path: "domains", lazy: () => import("./pages/DomainsPage").then((m) => ({ Component: m.DomainsPage })) },
      { path: "domains/:id", lazy: () => import("./pages/DomainDetailPage").then((m) => ({ Component: m.DomainDetailPage })) },
      { path: "queue", lazy: () => import("./pages/QueuePage").then((m) => ({ Component: m.QueuePage })) },
      { path: "shortlist", lazy: () => import("./pages/ShortlistPage").then((m) => ({ Component: m.ShortlistPage })) },
      { path: "filters", lazy: () => import("./pages/SavedFiltersPage").then((m) => ({ Component: m.SavedFiltersPage })) },
      { path: "imports", lazy: () => import("./pages/ImportsPage").then((m) => ({ Component: m.ImportsPage })) },
      { path: "settings", lazy: () => import("./pages/SettingsPage").then((m) => ({ Component: m.SettingsPage })) },
      { path: "*", lazy: () => import("./pages/NotFoundPage").then((m) => ({ Component: m.NotFoundPage })) },
    ],
  },
]);
