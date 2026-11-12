import { MessagesSquare, Route, Sparkles } from 'lucide-react';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { AssistantStatusBanner, ChatPanel, PlanTripPanel } from '@/features/assistant';

export default function AssistantPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="עוזר AI"
        icon={<Sparkles />}
        description="שיחה בעברית לחיפוש ותכנון טיולים משפחתיים. העוזר מחפש ומציג הצעות מתוך המערכת — הוא אינו מזמין ואינו מבצע תשלום."
      />
      <AssistantStatusBanner />
      <Tabs defaultValue="chat">
        <TabsList aria-label="מצבי עוזר">
          <TabsTrigger value="chat">
            <MessagesSquare aria-hidden="true" /> שיחה
          </TabsTrigger>
          <TabsTrigger value="plan">
            <Route aria-hidden="true" /> תכנון טיול
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat">
          <ChatPanel />
        </TabsContent>
        <TabsContent value="plan">
          <PlanTripPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
