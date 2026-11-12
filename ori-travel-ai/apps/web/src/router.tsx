/**
 * Route table. Each page lives in its own file under src/pages/<area>/<Name>Page.tsx
 * with a default export; later agents replace page files without touching this router.
 */
import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { FullPageStatus } from '@/components/layout/FullPageStatus';
import { RootLayout } from '@/components/layout/RootLayout';
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary';
import { RequireAuth } from '@/features/auth';

/** Lazy route helper: code-splits each page. */
function page(load: () => Promise<{ default: ComponentType }>): Pick<RouteObject, 'lazy'> {
  return { lazy: async () => ({ Component: (await load()).default }) };
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    hydrateFallbackElement: <FullPageStatus kind="loading" />,
    children: [
      { path: '/login', ...page(() => import('@/pages/auth/LoginPage')) },
      { path: '/invite', ...page(() => import('@/pages/auth/AcceptInvitePage')) },
      { path: '/invite/:token', ...page(() => import('@/pages/auth/AcceptInvitePage')) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            errorElement: <RouteErrorBoundary />,
            children: [
              { index: true, ...page(() => import('@/pages/dashboard/DashboardPage')) },
              { path: 'assistant', ...page(() => import('@/pages/assistant/AssistantPage')) },
              { path: 'search/flights', ...page(() => import('@/pages/search/FlightsSearchPage')) },
              { path: 'search/hotels', ...page(() => import('@/pages/search/HotelsSearchPage')) },
              { path: 'search/cars', ...page(() => import('@/pages/search/CarsSearchPage')) },
              { path: 'search/activities', ...page(() => import('@/pages/search/ActivitiesSearchPage')) },
              { path: 'compare', ...page(() => import('@/pages/compare/ComparePage')) },
              { path: 'saved', ...page(() => import('@/pages/saved/SavedOffersPage')) },
              { path: 'trips', ...page(() => import('@/pages/trips/TripsPage')) },
              { path: 'trips/:tripId', ...page(() => import('@/pages/trips/TripDetailPage')) },
              { path: 'alerts', ...page(() => import('@/pages/alerts/AlertsPage')) },
              { path: 'bookings', ...page(() => import('@/pages/bookings/BookingsPage')) },
              { path: 'bookings/:bookingId', ...page(() => import('@/pages/bookings/BookingDetailPage')) },
              { path: 'family', ...page(() => import('@/pages/family/FamilyPage')) },
              { path: 'providers', ...page(() => import('@/pages/providers/ProvidersPage')) },
              { path: 'settings', ...page(() => import('@/pages/settings/SettingsPage')) },
              { path: 'help', ...page(() => import('@/pages/help/HelpPage')) },
              { path: '*', ...page(() => import('@/pages/system/NotFoundPage')) },
            ],
          },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
