import fixtures from '@/test/fixtures/contracts.json';
import { ApiErrorEnvelopeSchema, MoneySchema, pageSchema, listOrPageSchema } from './common';
import { CanonicalOfferSchema, isOfferKind } from './offers';
import { SearchResponseSchema } from './search';
import { SessionOutSchema } from './auth';
import { ProviderStatusSchema, providerDisplayName, providerMode } from './providers';
import { z } from 'zod';

// contracts.json is generated from the backend Pydantic models (apps/api/app/schemas),
// so these tests catch drift between the API and the frontend schemas.
describe('contract schemas', () => {
  it('parses canonical offers of all four kinds (discriminated by details.kind)', () => {
    const kinds = fixtures.offers.map((o) => CanonicalOfferSchema.parse(o).details.kind);
    expect(kinds).toEqual(['flight', 'hotel', 'car', 'activity']);
  });

  it('keeps money as decimal strings and narrows details', () => {
    const offer = CanonicalOfferSchema.parse(fixtures.offers[0]);
    expect(offer.price.total).toEqual({ amount: '1234.50', currency: 'ILS' });
    expect(offer.score?.quality).toBe('65.25');
    expect(isOfferKind(offer, 'flight') && offer.details.slices[0].segments[0].departing_at).toBe('2026-12-01T08:15:00+02:00');
    expect(offer.price.components[1]).toMatchObject({ status: 'excluded', included_in_total: false });
  });

  it('rejects an offer whose details kind is unknown', () => {
    const bad = structuredClone(fixtures.offers[1]) as Record<string, unknown> & { details: { kind: string } };
    bad.details.kind = 'cruise';
    expect(CanonicalOfferSchema.safeParse(bad).success).toBe(false);
  });

  it('parses a search response with provider runs', () => {
    const resp = SearchResponseSchema.parse(fixtures.searchResponse);
    expect(resp.providers.map((p) => p.status)).toEqual(['OK', 'NOT_CONFIGURED']);
    expect(resp.has_demo_results).toBe(true);
  });

  it('rejects float money amounts', () => {
    expect(MoneySchema.safeParse({ amount: 12.5, currency: 'ILS' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '12.5', currency: 'ILS' }).success).toBe(true);
  });

  it('parses pages, list-or-page and error envelopes', () => {
    expect(pageSchema(z.string()).parse({ items: ['a'], total: 1, page: 1, page_size: 20 }).items).toEqual(['a']);
    const lop = listOrPageSchema(z.number());
    expect(lop.parse([1, 2])).toEqual([1, 2]);
    expect(lop.parse({ items: [3], total: 1, page: 1, page_size: 20 })).toEqual([3]);
    expect(
      ApiErrorEnvelopeSchema.parse({ error: { code: 'NOT_FOUND', message: 'לא נמצא', details: null, request_id: null } }).error.code,
    ).toBe('NOT_FOUND');
  });

  it('parses a session', () => {
    const s = SessionOutSchema.parse({
      user: {
        id: '1',
        email: 'a@b.co',
        display_name: 'א',
        role: 'adult',
        is_active: true,
        legal_adult_attested: false,
        can_book: false,
        last_login_at: null,
        created_at: '2026-11-12T10:00:00.123456Z',
      },
      csrf_token: 't',
    });
    expect(s.user.role).toBe('adult');
  });

  it('accepts provider status with flattened or nested capabilities', () => {
    const flat = ProviderStatusSchema.parse({
      provider_id: 'demo_air',
      display_name: 'דמו-אייר',
      mode: 'DEMO',
      status: 'OK',
      enabled: true,
      configured: true,
    });
    const nested = ProviderStatusSchema.parse({
      provider_id: 'duffel',
      capabilities: { display_name: 'Duffel', mode: 'LIVE' },
      status: 'NOT_CONFIGURED',
      enabled: false,
      configured: false,
      requires_credentials: ['ORI_DUFFEL_ACCESS_TOKEN'],
    });
    expect([providerDisplayName(flat), providerMode(flat)]).toEqual(['דמו-אייר', 'DEMO']);
    expect([providerDisplayName(nested), providerMode(nested)]).toEqual(['Duffel', 'LIVE']);
  });
});
