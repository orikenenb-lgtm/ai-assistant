/**
 * רשימת לשוניות נגישה (role=tablist) עם ניווט חיצים לפי RTL:
 * חץ שמאלה = הלשונית הבאה, חץ ימינה = הקודמת (בעברית קוראים מימין לשמאל).
 * במצב אנכי: חץ למטה = הבאה.
 */
import { useRef, type KeyboardEvent } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({
  items,
  selected,
  onSelect,
  idPrefix,
  label,
  orientation = 'horizontal',
  className,
}: {
  items: ReadonlyArray<TabItem<T>>;
  selected: T;
  onSelect: (id: T) => void;
  idPrefix: string;
  label: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((t) => t.id === selected);
    if (index < 0) return;
    let next = -1;
    const vertical = orientation === 'vertical';
    if ((!vertical && e.key === 'ArrowLeft') || (vertical && e.key === 'ArrowDown')) next = (index + 1) % items.length;
    else if ((!vertical && e.key === 'ArrowRight') || (vertical && e.key === 'ArrowUp')) next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = items[next];
    if (!target) return;
    onSelect(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} aria-orientation={orientation} className={className ?? 'tabs'} onKeyDown={onKeyDown}>
      {items.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            if (el) refs.current.set(t.id, el);
            else refs.current.delete(t.id);
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={t.id === selected}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === selected ? 0 : -1}
          className="tab"
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
