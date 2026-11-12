import { Bookmark, Scale } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/QueryState';
import { ButtonLink, EmptyState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { OfferDetailDialog, useCompareSelection } from '@/features/offers';
import { SavedOfferItem } from '@/features/saved/components/SavedOfferItem';
import { useSavedOffers } from '@/features/saved/hooks';
import { useTrips } from '@/features/trips/hooks';
import { CATEGORY_LABELS, CATEGORY_SEARCH_PATH } from '@/lib/labels';
import { CATEGORIES, type Category } from '@/lib/schemas/common';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import type { SavedOffer } from '@/lib/schemas/saved';

type Tab = 'all' | Category;

export default function SavedOffersPage() {
  const query = useSavedOffers();
  const trips = useTrips();
  const selection = useCompareSelection();
  const [tab, setTab] = useState<Tab>('all');
  const [detail, setDetail] = useState<CanonicalOffer | null>(null);

  return (
    <>
      <PageHeader
        title="הצעות שמורות"
        description="הרשימה האישית שלך. ההערות והשיוך לטיולים פרטיים — רק את/ה רואה אותם."
        icon={<Bookmark />}
        actions={
          <ButtonLink to="/compare" variant="secondary" leadingIcon={<Scale aria-hidden="true" />}>
            {selection.count > 0 ? `להשוואה (${selection.count})` : 'להשוואה'}
          </ButtonLink>
        }
      />
      <QueryState
        query={query}
        loading={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-80" />
            <Skeleton className="h-48 w-full" />
          </div>
        }
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={<Bookmark />}
            title="עוד לא שמרתם הצעות"
            description='בתוצאות החיפוש לחצו "שמירה" על הצעות מעניינות, והן יחכו לכם כאן להשוואה ולהוספה לטיול.'
            action={<ButtonLink to="/search/flights">לחיפוש טיסות</ButtonLink>}
          />
        }
      >
        {(all) => {
          const counts = (c: Tab) => (c === 'all' ? all.length : all.filter((s) => s.category === c).length);
          const shown: SavedOffer[] = tab === 'all' ? all : all.filter((s) => s.category === tab);
          return (
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList aria-label="סינון לפי קטגוריה">
                <TabsTrigger value="all">הכול ({counts('all')})</TabsTrigger>
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c} value={c}>
                    {CATEGORY_LABELS[c]} ({counts(c)})
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={tab}>
                {shown.length === 0 ? (
                  <EmptyState
                    compact
                    title={`אין הצעות שמורות ב"${tab === 'all' ? 'הכול' : CATEGORY_LABELS[tab]}"`}
                    action={tab !== 'all' ? <ButtonLink to={CATEGORY_SEARCH_PATH[tab]} variant="secondary" size="sm">לחיפוש</ButtonLink> : undefined}
                  />
                ) : (
                  <ul className="flex flex-col gap-6">
                    {shown.map((s) => (
                      <SavedOfferItem key={s.id} saved={s} trips={trips.data ?? []} canAssign={!!trips.data} onOpenDetails={setDetail} />
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          );
        }}
      </QueryState>
      <OfferDetailDialog offer={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </>
  );
}
