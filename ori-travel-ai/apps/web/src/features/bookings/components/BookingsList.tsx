import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router';
import { DataTable, DateText, EmptyState, MoneyText, Pagination, type DataTableColumn } from '@/components/ui';
import { CATEGORY_SINGULAR } from '@/lib/labels';
import type { BookingSummary } from '@/lib/schemas/bookings';
import { PAGE_SIZE } from '../api';
import { BookingStateBadge, DemoSupplierBadge, SimulationBadge } from './BookingStateBadge';

const columns: DataTableColumn<BookingSummary>[] = [
  {
    id: 'title',
    header: 'הזמנה',
    cell: (b) => (
      <div className="min-w-0">
        <Link to={`/bookings/${encodeURIComponent(b.id)}`} className="font-semibold text-accent underline-offset-4 hover:underline">
          {b.title}
        </Link>
        <p className="text-xs text-fg-subtle">{CATEGORY_SINGULAR[b.category]}</p>
      </div>
    ),
  },
  {
    id: 'state',
    header: 'מצב',
    cell: (b) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <BookingStateBadge state={b.state} label={b.state_label} />
        {b.is_simulation && <SimulationBadge />}
        {b.is_demo && !b.is_simulation && <DemoSupplierBadge />}
        {b.price_changed && b.state !== 'CONFIRMED' && (
          <span className="text-xs font-medium text-amber-700">המחיר השתנה</span>
        )}
      </div>
    ),
  },
  { id: 'price', header: 'מחיר', align: 'end', cell: (b) => <MoneyText value={b.current_price} className="font-semibold" /> },
  { id: 'provider', header: 'ספק', hideOnMobile: true, cell: (b) => b.provider_name },
  { id: 'travelers', header: 'נוסעים', align: 'center', hideOnMobile: true, cell: (b) => b.travelers_count },
  { id: 'created', header: 'נוצרה', hideOnMobile: true, cell: (b) => <DateText value={b.created_at} preset="date-short" /> },
  { id: 'updated', header: 'עודכנה', cell: (b) => <DateText value={b.updated_at} preset="datetime" /> },
];

export function BookingsList({
  items,
  total,
  page,
  loading,
  onPageChange,
  filtered,
}: {
  items: BookingSummary[];
  total: number;
  page: number;
  loading?: boolean;
  onPageChange: (p: number) => void;
  filtered: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="רשימת הזמנות"
        columns={columns}
        rows={items}
        getRowKey={(b) => b.id}
        loading={loading}
        empty={
          <EmptyState
            icon={<ClipboardList />}
            title={filtered ? 'אין הזמנות במצב הזה' : 'עדיין לא הוכנו הזמנות'}
            description={filtered ? 'נסו לבחור מצב אחר או לנקות את הסינון.' : 'שמרו הצעה מתוצאות החיפוש ואז הכינו ממנה הזמנה.'}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} />
    </div>
  );
}
