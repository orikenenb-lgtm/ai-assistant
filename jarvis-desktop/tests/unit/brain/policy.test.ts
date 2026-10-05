import { describe, expect, it } from 'vitest';
import { decideApproval } from '../../../src/main/permissions/policy';
import { defaultSettings } from '../../../src/shared/settings-schema';
import type { ToolRisk } from '../../../src/main/core/contracts';

const base = { settings: defaultSettings(), tainted: false, userInitiated: false, displayCount: 1, displayChosen: false };
const def = (risk: ToolRisk, sideEffect: boolean) => ({ risk, sideEffect });

describe('approval policy', () => {
  it('high risk always requires approval (policy)', () => {
    expect(decideApproval({ ...base, def: def('high', false), userInitiated: true })).toEqual({ required: true, reason: 'policy' });
  });

  it('privacy: requireConfirmation applies unless user-initiated', () => {
    expect(decideApproval({ ...base, def: def('privacy', false) })).toEqual({ required: true, reason: 'privacy' });
    expect(decideApproval({ ...base, def: def('privacy', false), userInitiated: true })).toEqual({ required: false });
    const off = defaultSettings();
    off.screen.requireConfirmation = false;
    expect(decideApproval({ ...base, settings: off, def: def('privacy', false) })).toEqual({ required: false });
  });

  it('privacy: several displays and none chosen -> screen picker (privacy), even when user-initiated', () => {
    expect(decideApproval({ ...base, def: def('privacy', false), userInitiated: true, displayCount: 2 })).toEqual({ required: true, reason: 'privacy' });
    expect(decideApproval({ ...base, def: def('privacy', false), userInitiated: true, displayCount: 2, displayChosen: true })).toEqual({ required: false });
  });

  it('privacy with confirmation off but a tainted model request still requires approval', () => {
    const off = defaultSettings();
    off.screen.requireConfirmation = false;
    expect(decideApproval({ ...base, settings: off, def: def('privacy', false), tainted: true })).toEqual({ required: true, reason: 'tainted' });
  });

  it('low/read: only tainted + side effect requires approval', () => {
    expect(decideApproval({ ...base, def: def('low', true) })).toEqual({ required: false });
    expect(decideApproval({ ...base, def: def('low', true), tainted: true })).toEqual({ required: true, reason: 'tainted' });
    expect(decideApproval({ ...base, def: def('read', false), tainted: true })).toEqual({ required: false });
    expect(decideApproval({ ...base, def: def('read', true), tainted: true })).toEqual({ required: true, reason: 'tainted' });
  });
});
