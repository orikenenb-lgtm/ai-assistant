import type { ReactNode } from 'react';
import { Badge, Card, CardHeader } from '@/components/ui';

export interface SettingsSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  icon: ReactNode;
  /** Shown as a badge when the viewer cannot change this section. */
  readOnlyReason?: string;
  children: ReactNode;
}

export function SettingsSection({ id, title, description, icon, readOnlyReason, children }: SettingsSectionProps) {
  return (
    <Card as="section" aria-labelledby={`${id}-title`} id={id} data-testid={`settings-${id}`}>
      <CardHeader
        title={<span id={`${id}-title`}>{title}</span>}
        description={description}
        icon={icon}
        actions={readOnlyReason ? <Badge tone="muted">{readOnlyReason}</Badge> : null}
      />
      {children}
    </Card>
  );
}
