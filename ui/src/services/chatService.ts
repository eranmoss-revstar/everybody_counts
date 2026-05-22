/**
 * Chat / RAG query service selector.
 *
 * Real mode → POST /docs (Bedrock KB retrieve-and-generate, see Lambdas.md).
 * Mock mode → rotates through canned demo responses with simulated latency.
 * Returns a uniform shape so ChatInterface doesn't branch on auth mode.
 */
import { queryDocs } from './api';
import mockApi from './mockApi';

const IS_REAL = process.env.REACT_APP_AUTH_MODE === 'cognito';

export interface ChatResponse {
  response: string;
  citation: string | null;
  sessionId: string | null;
  followUpSuggestions: string[];
}

export async function queryChat(
  question: string,
  sessionId: string | undefined,
  authToken: string | null,
): Promise<ChatResponse> {
  if (IS_REAL) {
    if (!authToken) throw new Error('Not authenticated');
    const data = await queryDocs(question, authToken, sessionId);
    return {
      response: data.response || 'No response received.',
      citation: data.citation ?? null,
      sessionId: data.sessionId ?? null,
      // The /docs Lambda doesn't currently surface follow-ups. When the
      // backend starts returning them, extend DocsResponse and read here.
      followUpSuggestions: [],
    };
  }

  const data = await mockApi.query({
    query: question,
    user_context: {
      tenant_id: 'demo-tenant',
      user_id: 'testuser',
      session_id: sessionId || 'demo',
    },
  });

  return {
    response: data.answer || 'Sorry, I could not process your request.',
    citation: null,
    sessionId: null,
    followUpSuggestions: data.follow_up_suggestions || [],
  };
}
