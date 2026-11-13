import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { RouterProvider } from 'react-router/dom';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/features/auth';
import { createQueryClient } from '@/lib/queryClient';
import { createAppRouter } from './router';

/** All app-wide providers (also used by tests with a custom router/query client). */
export function AppProviders({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
