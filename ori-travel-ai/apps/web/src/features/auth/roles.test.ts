import { canBook, canEdit, isOwner } from './roles';

const base = { is_active: true, legal_adult_attested: false, can_book: false };

describe('role helpers', () => {
  it('owner can do everything (booking requires attestation)', () => {
    const owner = { ...base, role: 'owner' as const, legal_adult_attested: true, can_book: true };
    expect(isOwner(owner)).toBe(true);
    expect(canEdit(owner)).toBe(true);
    expect(canBook(owner)).toBe(true);
  });
  it('adult can edit; booking only when attested', () => {
    expect(canEdit({ ...base, role: 'adult' })).toBe(true);
    expect(canBook({ ...base, role: 'adult' })).toBe(false);
    expect(canBook({ ...base, role: 'adult', legal_adult_attested: true, can_book: true })).toBe(true);
  });
  it('viewer is read-only', () => {
    const viewer = { ...base, role: 'viewer' as const, legal_adult_attested: true, can_book: true };
    expect(canEdit(viewer)).toBe(false);
    expect(canBook(viewer)).toBe(false);
    expect(isOwner(viewer)).toBe(false);
  });
  it('inactive or missing users get nothing', () => {
    expect(canEdit(null)).toBe(false);
    expect(canEdit({ ...base, role: 'owner', is_active: false })).toBe(false);
  });
});
