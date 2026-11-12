import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Button, ButtonLink, buttonClasses } from './Button';

describe('<Button>', () => {
  it('is single-line by default and has the touch-target hit area', () => {
    render(<Button>שמירה</Button>);
    const btn = screen.getByRole('button', { name: 'שמירה' });
    expect(btn).toHaveClass('whitespace-nowrap', 'touch-target', 'h-10');
    expect(btn).not.toHaveClass('whitespace-normal');
  });

  it('`wrap` lets long labels break onto several lines with the same minimum height', () => {
    render(
      <Button size="lg" wrap>
        סימולציה: השלמת ההזמנה אצל הספק (ללא תשלום)
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('whitespace-normal', 'min-h-12', 'max-w-full');
    expect(btn).not.toHaveClass('whitespace-nowrap');
    expect(btn).not.toHaveClass('h-12');
  });

  it('ButtonLink accepts `wrap` without leaking it to the DOM', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/x" wrap>
          קישור
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'קישור' });
    expect(link).toHaveClass('whitespace-normal');
    expect(link).not.toHaveAttribute('wrap');
  });

  it('buttonClasses supports the deal variant', () => {
    expect(buttonClasses({ variant: 'deal' })).toContain('bg-deal-strong');
  });
});
