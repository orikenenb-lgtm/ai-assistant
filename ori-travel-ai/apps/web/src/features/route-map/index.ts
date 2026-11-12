/** Route map (flights). The SVG + bundled basemap live in a lazily loaded chunk. */
import { lazy } from 'react';

export { buildRoute, type RouteLeg, type RouteModel, type RoutePoint } from './legs';
export type { RouteMapProps } from './components/RouteMap';

export const LazyRouteMap = lazy(() => import('./components/RouteMap'));
