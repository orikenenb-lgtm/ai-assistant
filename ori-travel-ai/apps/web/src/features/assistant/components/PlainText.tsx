import { Fragment } from 'react';
import { cn } from '@/lib/cn';

/**
 * Renders untrusted text as TEXT. React escapes everything, so markup such as
 * `<img onerror=…>` is shown literally. Only line breaks are interpreted.
 * Never replace this with dangerouslySetInnerHTML or a markdown renderer.
 */
export function PlainText({ text, className }: { text: string; className?: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <p className={cn('whitespace-pre-wrap break-words', className)}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </p>
  );
}
