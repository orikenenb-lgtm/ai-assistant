import { Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, ButtonLink } from '@/components/ui';
import { isApiError } from '@/lib/api';
import { CATEGORY_SEARCH_PATH } from '@/lib/labels';
import type { Category } from '@/lib/schemas/common';
import type { SearchResponse } from '@/lib/schemas/search';
import { useRunSearch, useSearchResult } from '../hooks';
import { serverFieldErrors } from '../forms/common';
import { activityFromParams, defaultActivityState } from '../forms/activity';
import { carFromParams, defaultCarState } from '../forms/car';
import { defaultFlightState, flightFromParams } from '../forms/flight';
import { defaultHotelState, hotelFromParams } from '../forms/hotel';
import { ActivitySearchForm } from './ActivitySearchForm';
import { CarSearchForm } from './CarSearchForm';
import { FlightSearchForm } from './FlightSearchForm';
import { HotelSearchForm } from './HotelSearchForm';
import { SearchResults } from './SearchResults';
import { SearchSummaryBar } from './SearchSummaryBar';

export interface SearchPageProps {
  category: Category;
  title: string;
  description: string;
  icon: ReactNode;
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" data-testid="results-skeleton">
      <span className="sr-only" role="status">
        טוענים תוצאות…
      </span>
      <Skeleton className="h-24 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-52 w-full" />
      ))}
    </div>
  );
}

function SearchForm({
  category,
  prefill,
  pending,
  serverErrors,
  onSubmit,
}: {
  category: Category;
  prefill: SearchResponse | undefined;
  pending: boolean;
  serverErrors: Record<string, string>;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const p = prefill?.category === category ? prefill.params : undefined;
  const common = { pending, serverErrors, onSubmit };
  switch (category) {
    case 'flight':
      return <FlightSearchForm {...common} initial={p ? flightFromParams(p) : defaultFlightState()} />;
    case 'hotel':
      return <HotelSearchForm {...common} initial={p ? hotelFromParams(p) : defaultHotelState()} />;
    case 'car':
      return <CarSearchForm {...common} initial={p ? carFromParams(p) : defaultCarState()} />;
    case 'activity':
      return <ActivitySearchForm {...common} initial={p ? activityFromParams(p) : defaultActivityState()} />;
  }
}

/**
 * Shared search screen for all four categories: form → POST /api/search/{category} → `?search_id=` in the URL →
 * results (GET /api/search/{id}) that survive refresh and dashboard deep links.
 */
export function SearchPage({ category, title, description, icon }: SearchPageProps) {
  const [params, setParams] = useSearchParams();
  const searchId = params.get('search_id');
  const base = useSearchResult(searchId);
  const run = useRunSearch(category);
  const [formOpen, setFormOpen] = useState(!searchId);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  function submit(body: Record<string, unknown>) {
    setServerErrors({});
    run.mutate(body, {
      onSuccess: (data) => {
        setParams({ search_id: data.search_id });
        setFormOpen(false);
      },
      onError: (e) => setServerErrors(serverFieldErrors(e)),
    });
  }

  // A search id from another category (e.g. hand-edited URL) → open it on its own page.
  if (base.data && base.data.category !== category) {
    return <Navigate to={`${CATEGORY_SEARCH_PATH[base.data.category]}?search_id=${encodeURIComponent(base.data.search_id)}`} replace />;
  }

  const showForm = formOpen || (!!searchId && base.isError);
  const showFormCard = showForm || (!base.data && !(searchId && base.isPending));
  const rateLimited = isApiError(run.error) && run.error.status === 429;

  return (
    <>
      <PageHeader title={title} description={description} icon={icon} />
      <div className="flex flex-col gap-6">
        {showFormCard ? (
          <Card>
            {rateLimited && (
              <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700" role="alert">
                {run.error instanceof Error ? run.error.message : 'הגעתם למגבלת החיפושים — נסו שוב בעוד מספר דקות'}
              </p>
            )}
            <SearchForm
              key={base.data?.search_id ?? 'new'}
              category={category}
              prefill={base.data}
              pending={run.isPending}
              serverErrors={rateLimited ? {} : serverErrors}
              onSubmit={submit}
            />
          </Card>
        ) : base.data ? (
          <SearchSummaryBar data={base.data} onEdit={() => setFormOpen(true)} />
        ) : null}

        {searchId ? (
          base.data ? (
            <SearchResults key={base.data.search_id} base={base.data} onEditSearch={() => setFormOpen(true)} />
          ) : base.isPending ? (
            <ResultsSkeleton />
          ) : isApiError(base.error) && base.error.status === 404 ? (
            <EmptyState
              icon={<Search />}
              title="החיפוש לא נמצא"
              description="ייתכן שהקישור ישן או שהחיפוש שייך למשתמש אחר. אפשר להתחיל חיפוש חדש."
              action={
                <ButtonLink to={CATEGORY_SEARCH_PATH[category]} variant="accent">
                  חיפוש חדש
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState error={base.error} title="לא ניתן לטעון את תוצאות החיפוש" onRetry={() => void base.refetch()} retrying={base.isFetching} />
          )
        ) : run.isPending ? (
          <ResultsSkeleton />
        ) : null}
      </div>
    </>
  );
}
