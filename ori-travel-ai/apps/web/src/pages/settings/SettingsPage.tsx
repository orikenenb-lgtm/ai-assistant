import { Settings as SettingsIcon } from 'lucide-react';
import { QueryState } from '@/components/QueryState';
import { Callout, PageHeader, Skeleton } from '@/components/ui';
import { ChangePasswordForm } from '@/features/account/ChangePasswordForm';
import { canEdit, isOwner, useAuth } from '@/features/auth';
import { DisplaySection, MapSection, RetentionSection, SchedulerSection } from '@/features/settings/components/BasicSections';
import { RankingWeightsSection } from '@/features/settings/components/RankingWeightsSection';
import { AiSection, SafetySection } from '@/features/settings/components/StatusSections';
import { useSettings } from '@/features/settings/hooks';

export default function SettingsPage() {
  const { user } = useAuth();
  const editable = canEdit(user);
  const owner = isOwner(user);
  const query = useSettings();
  return (
    <>
      <PageHeader title="הגדרות" description="הגדרות המשפחה, מצב המערכת והחשבון האישי שלך." icon={<SettingsIcon />} />
      <div className="flex flex-col gap-6">
        {!owner && (
          <Callout tone="neutral" title={editable ? 'חלק מההגדרות שמורות לבעל החשבון' : 'תצוגה בלבד'}>
            {editable ? 'אפשר לשנות משקלות דירוג ומטבע תצוגה. הגדרות שרת מוצגות לקריאה בלבד.' : 'אפשר לראות את ההגדרות אבל לא לשנות אותן. שינוי הסיסמה שלך זמין תמיד בתחתית העמוד.'}
          </Callout>
        )}
        <QueryState
          query={query}
          compact={false}
          errorTitle="לא ניתן לטעון את ההגדרות"
          loading={
            <div className="flex flex-col gap-6">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          }
        >
          {(settings) => (
            <>
              <RankingWeightsSection settings={settings} editable={editable} />
              <DisplaySection settings={settings} editable={editable} />
              <MapSection settings={settings} owner={owner} />
              <SchedulerSection settings={settings} owner={owner} />
              <RetentionSection settings={settings} owner={owner} />
              <AiSection settings={settings} />
              <SafetySection settings={settings} />
            </>
          )}
        </QueryState>
        <ChangePasswordForm />
      </div>
    </>
  );
}
