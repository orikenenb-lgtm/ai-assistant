/** AI assistant API (contract §3.6). Conversations are NOT stored on the server. */
import { api } from '@/lib/api';
import {
  AiStatusSchema,
  ChatResponseSchema,
  PlanTripResponseSchema,
  type ChatRequest,
  type PlanTripRequest,
} from '@/lib/schemas/ai';

export const assistantKeys = { status: ['ai', 'status'] as const };

export const fetchAiStatus = () => api.get('/api/ai/status', { schema: AiStatusSchema });

export const sendChat = (body: ChatRequest) => api.post('/api/ai/chat', body, { schema: ChatResponseSchema });

export const requestPlan = (body: PlanTripRequest) => api.post('/api/ai/plan-trip', body, { schema: PlanTripResponseSchema });
