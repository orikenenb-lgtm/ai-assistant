import { Outlet, ScrollRestoration } from 'react-router';

/** Router root: scroll restoration + outlet. Providers live in App.tsx. */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
