import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock, errorResponse, jsonResponse, renderWithProviders } from '@/test/utils';
import { compareSelection } from '../compareSelection';
import { makeFlightOffer } from '../testFixtures';
import { OfferCard } from './OfferCard';
import { PriceBreakdown } from './PriceBreakdown';

describe('OfferCard', () => {
  beforeEach(() => {
    compareSelection.clear();
    vi.unstubAllGlobals();
  });

  it('shows price, source mode, cancellation, rank and other providers', () => {
    renderWithProviders(<OfferCard offer={makeFlightOffer()} onOpenDetails={() => {}} />);
    expect(screen.getByRole('article', { name: /תל אביב – אתונה/ })).toBeInTheDocument();
    expect(screen.getByTestId('source-line')).toHaveTextContent('דמו סקייליין');
    expect(screen.getByTestId('source-line')).toHaveTextContent('הדגמה');
    expect(screen.getByTestId('cancellation-summary')).toHaveTextContent('ללא החזר כספי');
    expect(screen.getByTestId('also-offered-by')).toHaveTextContent('דמו אורורה');
    expect(screen.getByText('ישירה')).toBeInTheDocument();
  });

  it('expands the score explanation', async () => {
    renderWithProviders(<OfferCard offer={makeFlightOffer()} />);
    await userEvent.click(screen.getByRole('button', { name: 'למה הציון הזה?' }));
    expect(screen.getByRole('region', { name: 'הסבר הניקוד' })).toHaveTextContent('טיסות ישירות');
    expect(screen.getAllByRole('meter')).toHaveLength(4);
  });

  it('toggles the compare selection', async () => {
    renderWithProviders(<OfferCard offer={makeFlightOffer({ id: 'abc' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'השוואה' }));
    expect(compareSelection.get()).toEqual(['abc']);
    expect(screen.getByRole('button', { name: 'נבחרה להשוואה' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles ALREADY_SAVED (409) gracefully', async () => {
    const fetchMock = createFetchMock({
      'POST /api/saved-offers': () => errorResponse(409, 'ALREADY_SAVED', 'ההצעה כבר שמורה'),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<OfferCard offer={makeFlightOffer({ id: 'dup' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'נשמרה' })).toBeDisabled());
  });

  it('degrades when the saved-offers backend is missing (404)', async () => {
    vi.stubGlobal('fetch', createFetchMock({}));
    renderWithProviders(<OfferCard offer={makeFlightOffer({ id: 'nf' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('שמירת הצעות עדיין לא זמינה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeEnabled();
  });

  it('posts the offer id when saving', async () => {
    const fetchMock = createFetchMock({ 'POST /api/saved-offers': () => jsonResponse({ id: 's1' }, { status: 201 }) });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<OfferCard offer={makeFlightOffer({ id: 'zz' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'נשמרה' })).toBeInTheDocument());
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ offer_id: 'zz' });
  });
});

describe('PriceBreakdown', () => {
  it('lists excluded components and notes separately from the known total', () => {
    renderWithProviders(<PriceBreakdown offer={makeFlightOffer({ excluded: true })} />);
    expect(screen.getByText('כלול במחיר')).toBeInTheDocument();
    expect(screen.getByText(/לא כלול בסכום ויתווסף בנפרד/)).toBeInTheDocument();
    expect(screen.getByText('המס משולם במלון')).toBeInTheDocument();
    expect(screen.getByText('מס עירוני').closest('li')).toHaveTextContent('לא כלול בסכום');
  });
});
