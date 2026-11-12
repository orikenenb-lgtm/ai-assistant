import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { validateActivity, defaultActivityState } from './activity';
import { validateCar, defaultCarState } from './car';
import { serverFieldErrors, addDaysIso, todayIso } from './common';
import { defaultFlightState, flightFromParams, validateFlight } from './flight';
import { defaultHotelState, validateHotel } from './hotel';

const NOW = new Date(2026, 10, 12, 10, 0, 0);
const today = todayIso(NOW);

describe('flight form', () => {
  const ok = { ...defaultFlightState(NOW), destination: 'ath' };

  it('builds the request body with uppercase IATA codes', () => {
    const r = validateFlight(ok, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toMatchObject({ origin: 'TLV', destination: 'ATH', adults: 2, children_ages: [], max_stops: null, max_price: null });
  });

  it('enforces the backend rules', () => {
    const bad = validateFlight({ ...ok, destination: 'TLV', departDate: addDaysIso(today, -3), returnDate: addDaysIso(today, -5), adults: 1, childrenAges: [0, 1] }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.destination).toMatch(/שונים/);
      expect(bad.errors.depart_date).toMatch(/עבר/);
      expect(bad.errors.children_ages).toMatch(/תינוק/);
    }
    const r = validateFlight({ ...ok, returnDate: addDaysIso(ok.departDate, -1) }, NOW);
    expect(!r.ok && r.errors.return_date).toMatch(/אחרי תאריך היציאה/);
    expect(validateFlight({ ...ok, origin: 'TL' }, NOW).ok).toBe(false);
    expect(validateFlight({ ...ok, departDate: addDaysIso(today, 400), returnDate: '' , tripType: 'oneway' }, NOW).ok).toBe(false);
    expect(validateFlight({ ...ok, adults: 8, childrenAges: [5, 6] }, NOW).ok).toBe(false);
    expect(validateFlight({ ...ok, maxPrice: '-5' }, NOW).ok).toBe(false);
  });

  it('one-way sends a null return date and round-trips params', () => {
    const r = validateFlight({ ...ok, tripType: 'oneway' }, NOW);
    expect(r.ok && r.body.return_date).toBeNull();
    const s = flightFromParams({ origin: 'TLV', destination: 'ATH', depart_date: '2026-12-20', return_date: null, adults: 3, children_ages: [4], max_stops: 1, max_price: '2000.00' });
    expect(s).toMatchObject({ tripType: 'oneway', adults: 3, childrenAges: [4], maxStops: '1', maxPrice: '2000' });
  });
});

describe('hotel form', () => {
  it('limits nights, rooms and child ages', () => {
    const base = { ...defaultHotelState(NOW), destination: 'אתונה' };
    expect(validateHotel(base, NOW).ok).toBe(true);
    const long = validateHotel({ ...base, checkOut: addDaysIso(base.checkIn, 31) }, NOW);
    expect(!long.ok && long.errors.check_out).toMatch(/30/);
    const same = validateHotel({ ...base, checkOut: base.checkIn }, NOW);
    expect(!same.ok && same.errors.check_out).toMatch(/אחרי/);
    const kids = validateHotel({ ...base, rooms: [{ adults: 2, childrenAges: [1, 2, 3, 4, 5] }] }, NOW);
    expect(!kids.ok && Object.keys(kids.errors).some((k) => k.startsWith('rooms.0'))).toBe(true);
    expect(validateHotel({ ...base, rooms: Array.from({ length: 6 }, () => ({ adults: 2, childrenAges: [] })) }, NOW).ok).toBe(false);
  });
});

describe('car form', () => {
  it('validates driver age and rental window', () => {
    const base = { ...defaultCarState(NOW), pickupLocation: 'ath' };
    const r = validateCar(base, NOW);
    expect(r.ok && r.body.pickup_location).toBe('ATH');
    expect(validateCar({ ...base, driverAge: '17' }, NOW).ok).toBe(false);
    const short = validateCar({ ...base, dropoffAt: base.pickupAt }, NOW);
    expect(!short.ok && short.errors.dropoff_at).toMatch(/שעה/);
    const diff = validateCar({ ...base, dropoffSame: false, dropoffLocation: '' }, NOW);
    expect(!diff.ok && diff.errors.dropoff_location).toBeTruthy();
  });
});

describe('activity form', () => {
  it('limits the date range to 30 days', () => {
    const base = { ...defaultActivityState(NOW), destination: 'אתונה' };
    expect(validateActivity(base, NOW).ok).toBe(true);
    expect(validateActivity({ ...base, dateTo: addDaysIso(base.dateFrom, 31) }, NOW).ok).toBe(false);
    expect(validateActivity({ ...base, dateTo: addDaysIso(base.dateFrom, -1) }, NOW).ok).toBe(false);
  });
});

describe('serverFieldErrors', () => {
  it('maps 422 details onto fields and form-level errors', () => {
    const err = new ApiError({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'x',
      details: [
        { field: 'origin', message: 'ערך לא תקין' },
        { field: '', message: 'depart_date: התאריך כבר עבר' },
        { field: '', message: 'מוצא ויעד חייבים להיות שונים' },
      ],
    });
    expect(serverFieldErrors(err)).toEqual({ origin: 'ערך לא תקין', depart_date: 'התאריך כבר עבר', '': 'מוצא ויעד חייבים להיות שונים' });
  });
});
