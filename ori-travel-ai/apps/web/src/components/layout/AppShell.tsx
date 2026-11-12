import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Drawer, Spinner } from '@/components/ui';
import { MobileTabBar } from './MobileTabBar';
import { SidebarNav } from './SidebarNav';
import { TopBar } from './TopBar';

// Decorative per-page travel backdrop (GSAP) — its own chunk, so it never delays the first paint of a page.
const PageScenery = lazy(() => import('@/features/scenery/PageScenery'));

function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById('main');
        main?.focus();
        main?.scrollIntoView({ block: 'start' });
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[90] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-accent-fg focus:shadow-lg"
    >
      דילוג לתוכן הראשי
    </a>
  );
}

function PageFallback() {
  return (
    <div className="grid min-h-60 place-items-center text-fg-subtle">
      <Spinner size="lg" />
    </div>
  );
}

/**
 * Authenticated layout (light): white right-side (RTL inline-start) sidebar on desktop,
 * drawer + bottom tab bar on mobile, sticky top bar, focus moved to <main> on navigation.
 */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Move focus to the new page for keyboard + screen-reader users.
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  // Deep links like /help#scoring: the target renders only after the auth check,
  // so scroll once the page content is mounted.
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);

  return (
    <div className="min-h-dvh bg-canvas">
      <SkipLink />

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-[var(--spacing-sidebar)] border-e border-line bg-surface lg:block">
        <SidebarNav />
      </aside>

      <Drawer open={menuOpen} onOpenChange={setMenuOpen} title="תפריט ניווט" hideTitle showCloseButton className="lg:hidden">
        <SidebarNav onNavigate={() => setMenuOpen(false)} />
      </Drawer>

      <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip lg:ps-[var(--spacing-sidebar)]">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />
        <Suspense fallback={null}>
          <PageScenery />
        </Suspense>
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="relative z-[1] mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(var(--spacing-tabbar)+2.5rem)] pt-6 focus:outline-none sm:px-6 lg:px-10 lg:pb-14 lg:pt-8"
        >
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <MobileTabBar />
    </div>
  );
}
