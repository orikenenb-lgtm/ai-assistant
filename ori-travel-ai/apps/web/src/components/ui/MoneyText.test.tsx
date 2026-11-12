import { render, screen } from '@testing-library/react';
import { formatMoney, stripBidi } from '@/lib/format';
import { MoneyText } from './MoneyText';

const text = (el: HTMLElement) => stripBidi(el.textContent ?? '');

describe('formatMoney (decimal strings, he-IL)', () => {
  it('formats ILS with two decimals and the shekel sign', () => {
    expect(stripBidi(formatMoney('1234.5', 'ILS')!)).toBe('1,234.50 ₪');
  });
  it('formats USD', () => {
    expect(stripBidi(formatMoney('99.99', 'USD')!)).toBe('99.99 $');
  });
  it('formats JPY without minor units', () => {
    expect(stripBidi(formatMoney('15000', 'JPY')!)).toBe('15,000 ¥');
  });
  it('keeps full precision for large string amounts (no float conversion)', () => {
    expect(stripBidi(formatMoney('12345678901234567.89', 'ILS')!)).toBe('12,345,678,901,234,567.89 ₪');
  });
  it('rounds half-even for display like the server', () => {
    expect(stripBidi(formatMoney('0.125', 'USD')!)).toBe('0.12 $');
    expect(stripBidi(formatMoney('0.135', 'USD')!)).toBe('0.14 $');
  });
  it('returns null for invalid input', () => {
    expect(formatMoney('12,00', 'ILS')).toBeNull();
    expect(formatMoney('abc', 'ILS')).toBeNull();
    expect(formatMoney('10', 'shekel')).toBeNull();
  });
});

describe('<MoneyText>', () => {
  it('renders a Money value', () => {
    render(<MoneyText value={{ amount: '2499.00', currency: 'ILS' }} />);
    expect(text(screen.getByText(/2,499/))).toBe('2,499.00 ₪');
  });

  it('renders amount + currency props', () => {
    render(<MoneyText amount="310.5" currency="USD" />);
    expect(text(screen.getByText(/310/))).toBe('310.50 $');
  });

  it('prefixes estimated prices', () => {
    const { container } = render(<MoneyText value={{ amount: '80', currency: 'EUR' }} estimated />);
    expect(text(container.firstElementChild as HTMLElement)).toBe('כ־80.00 €');
  });

  it('shows the fallback for invalid amounts', () => {
    render(<MoneyText amount="not-a-number" currency="ILS" />);
    expect(screen.getByLabelText('סכום לא זמין')).toHaveTextContent('—');
  });
});
