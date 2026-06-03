import { queryDocs, ChatMessage } from './api';
import mockApi from './mockApi';

const IS_REAL = process.env.REACT_APP_AUTH_MODE === 'cognito';

export interface ChatResponse {
  response: string;
  citation: string | null;
  sessionId: string | null;
  followUpSuggestions: string[];
  sources: string[];
  sourceLinks: { name: string; url: string }[];
}

export async function queryChat(
  question: string,
  authToken: string | null,
  conversationHistory: ChatMessage[] = [],
  sessionId?: string,
  onProgress?: (message: string) => void,
): Promise<ChatResponse> {
  if (IS_REAL) {
    if (!authToken) throw new Error('Not authenticated');
    const data = await queryDocs(question, authToken, conversationHistory, sessionId, onProgress);
    return {
      response: data.response || 'No response received.',
      citation: null,
      sessionId: data.sessionId ?? null,
      followUpSuggestions: [],
      sources: data.sources || [],
      sourceLinks: data.sourceLinks || [],
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
    sourceLinks: [],
  };
}
