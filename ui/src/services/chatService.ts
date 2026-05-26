import { queryDocs, ChatMessage } from './api';
import mockApi from './mockApi';

const IS_REAL = process.env.REACT_APP_AUTH_MODE === 'cognito';

export interface ChatResponse {
  response: string;
  citation: string | null;
  sessionId: string | null;
  followUpSuggestions: string[];
  sources: string[];
}

export async function queryChat(
  question: string,
  authToken: string | null,
  conversationHistory: ChatMessage[] = [],
  sessionId?: string,
): Promise<ChatResponse> {
  if (IS_REAL) {
    if (!authToken) throw new Error('Not authenticated');
    const data = await queryDocs(question, authToken, conversationHistory, sessionId);
    return {
      response: data.response || 'No response received.',
      citation: null,
      sessionId: data.sessionId ?? null,
      followUpSuggestions: [],
      sources: data.sources || [],
    };
  }

  const data = await mockApi.query({
    query: question,
    user_context: { tenant_id: 'demo-tenant', user_id: 'testuser', session_id: 'demo' },
  });

  return {
    response: data.answer || 'Sorry, I could not process your request.',
    citation: null,
    sessionId: null,
    followUpSuggestions: data.follow_up_suggestions || [],
    sources: [],
  };
}
