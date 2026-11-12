import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Legend } from './Legend';
import { Segmented } from './Segmented';

const VIEW_OPTIONS = [
  { value: 'list', label: 'רשימה', testId: 'view-list' },
  { value: 'table', label: 'טבלה', testId: 'view-table' },
  { value: 'map', label: 'מפה', disabled: true },
] as const;

type View = (typeof VIEW_OPTIONS)[number]['value'];

function Controlled({ onChange }: { onChange?: (v: View) => void }) {
  const [view, setView] = useState<View>('list');
  return (
    <>
      <Segmented<View>
        label="תצוגת תוצאות"
        options={VIEW_OPTIONS}
        value={view}
        onValueChange={(v) => {
          setView(v);
          onChange?.(v);
        }}
        data-testid="view-toggle"
      />
      <p>תצוגה: {view}</p>
    </>
  );
}

describe('<Segmented>', () => {
  it('is a named radio group with the current value checked', () => {
    render(<Controlled />);
    const group = screen.getByRole('radiogroup', { name: 'תצוגת תוצאות' });
    expect(group).toHaveAttribute('data-testid', 'view-toggle');
    expect(screen.getByRole('radio', { name: 'רשימה' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'טבלה' })).not.toBeChecked();
    expect(screen.getByTestId('view-list')).toHaveAttribute('data-state', 'checked');
  });

  it('selects by click and reports the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByText('טבלה'));
    expect(onChange).toHaveBeenCalledWith('table');
    expect(screen.getByRole('radio', { name: 'טבלה' })).toBeChecked();
    expect(screen.getByText('תצוגה: table')).toBeInTheDocument();
  });

  it('does not select disabled options', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'מפה' })).toBeDisabled();
    await user.click(screen.getByText('מפה'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('works uncontrolled and keeps labels for screen readers when icon-only', async () => {
    const user = userEvent.setup();
    render(
      <Segmented
        label="סוג לוח"
        iconOnly
        defaultValue="matrix"
        options={[
          { value: 'month', label: 'חודש', icon: <svg /> },
          { value: 'matrix', label: 'מטריצה', icon: <svg /> },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'מטריצה' })).toBeChecked();
    expect(screen.getByText('חודש')).toHaveClass('sr-only');
    await user.click(screen.getByRole('radio', { name: 'חודש' }));
    expect(screen.getByRole('radio', { name: 'חודש' })).toBeChecked();
  });
});

describe('<Legend>', () => {
  it('renders every item as text with a decorative swatch', () => {
    render(
      <Legend
        title="מקרא"
        data-testid="fare-legend"
        items={[
          { id: 'best', label: 'הזול ביותר', swatchClassName: 'bg-heat-best', marker: '★' },
          { id: 'none', label: 'אין טיסות', swatchClassName: 'bg-heat-none', marker: '∅', description: 'נבדק' },
        ]}
      >
        <span>הדגמה</span>
      </Legend>,
    );
    const list = screen.getByRole('list', { name: 'מקרא' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('הזול ביותר')).toBeInTheDocument();
    expect(screen.getByText(/נבדק/)).toBeInTheDocument();
    expect(screen.getByText('★')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('הדגמה')).toBeInTheDocument();
    expect(screen.getByTestId('fare-legend')).toBeInTheDocument();
  });
});
