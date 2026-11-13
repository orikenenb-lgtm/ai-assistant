import { Outlet, ScrollRestoration } from 'react-router';
// Side effect: resolves the colour theme (stored choice or system) before the first render.
import './theme';

/** Router root: scroll restoration + outlet. Providers live in App.tsx. */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
