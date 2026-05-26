export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  userMessage: string;
  conversationHistory: ChatMessage[];
  sessionId?: string;
}

export interface ChatResponse {
  response: string;
  sessionId?: string | null;
  sources?: string[];
}

const BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3001').replace(/\/$/, '');
// Function URL bypasses the API Gateway 29-second hard timeout — used for /chat only
const CHAT_URL = process.env.REACT_APP_CHAT_FUNCTION_URL
  ? process.env.REACT_APP_CHAT_FUNCTION_URL.replace(/\/$/, '')
  : `${BASE_URL}/chat`;

export async function queryDocs(
  userMessage: string,
  authToken: string,
  conversationHistory: ChatMessage[] = [],
  sessionId?: string,
): Promise<ChatResponse> {
  const body: ChatRequest = { userMessage, conversationHistory, sessionId };

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return response.json();
}
