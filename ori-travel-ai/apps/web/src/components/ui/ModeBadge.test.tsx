import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MODE_BADGE_CONFIG, ModeBadge, type ModeBadgeValue } from './ModeBadge';

const EXPECTED: Array<[ModeBadgeValue, string]> = [
  ['DEMO', 'הדגמה'],
  ['LIVE', 'חי'],
  ['CACHED', 'שמור במטמון'],
  ['FAILED', 'נכשל'],
  ['NOT_CONFIGURED', 'לא מחובר'],
  ['DISABLED', 'מושבת'],
  ['DEGRADED', 'חלקי'],
  ['OK', 'תקין'],
];

describe('<ModeBadge>', () => {
  it.each(EXPECTED)('%s shows the Hebrew label "%s" with an icon', (mode, label) => {
    const { container } = render(<ModeBadge mode={mode} showTooltip={false} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector(`[data-mode="${mode}"] svg`)).not.toBeNull();
  });

  it('gives screen readers context for the short label', () => {
    render(<ModeBadge mode="DEMO" showTooltip={false} />);
    expect(screen.getByText('מקור נתונים:')).toHaveClass('sr-only');
  });

  it('explains the mode in a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<ModeBadge mode="CACHED" />);
    await user.tab();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(MODE_BADGE_CONFIG.CACHED.description);
  });
});
