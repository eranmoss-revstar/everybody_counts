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
  sourceLinks?: { name: string; url: string }[];
}

const BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3001').replace(/\/$/, '');
// Function URL bypasses the API Gateway 29-second hard timeout — used for /chat only
const CHAT_URL = process.env.REACT_APP_CHAT_FUNCTION_URL
  ? process.env.REACT_APP_CHAT_FUNCTION_URL.replace(/\/$/, '')
  : `${BASE_URL}/chat`;

export interface AdminSettings {
  temperature: number;
  maxTokens: number;
  format: 'structured' | 'prose' | 'step_by_step';
  outputType: 'explanation' | 'lesson_plan' | 'activity_ideas';
}

export async function getAdminSettings(authToken: string): Promise<AdminSettings> {
  const response = await fetch(`${BASE_URL}/admin/settings`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!response.ok) throw new Error(`Failed to get settings (${response.status})`);
  return response.json();
}

export async function updateAdminSettings(authToken: string, settings: AdminSettings): Promise<AdminSettings> {
  const response = await fetch(`${BASE_URL}/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(`Failed to save settings (${response.status})`);
  return response.json();
}

export async function queryDocs(
  userMessage: string,
  authToken: string,
  conversationHistory: ChatMessage[] = [],
  sessionId?: string,
  onProgress?: (message: string) => void,
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

  const contentType = response.headers.get('content-type') || '';

  // ── SSE / RESPONSE_STREAM response ───────────────────────────────────────
  if (response.body && (contentType.includes('text/event-stream') || contentType.includes('application/octet-stream'))) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';  // SSE line accumulator
    let rawAll = '';     // full raw body accumulator (fallback)

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawAll += chunk;
      sseBuffer += chunk;

      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw);
          if (event.error) throw new Error(event.error);
          if (event.progress && onProgress) onProgress(event.progress);
          if (event.done) {
            return {
              response: event.response || '',
              sessionId: event.sessionId ?? null,
              sources: event.sources || [],
              sourceLinks: event.sourceLinks || [],
            };
          }
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }

    // No SSE done event — try the full raw body as plain JSON (buffered fallback)
    try {
      const data = JSON.parse(rawAll.trim());
      if (data.error) throw new Error(data.error);
      if (data.response !== undefined) return data as ChatResponse;
      // Wrapped API GW proxy format
      if (data.body) {
        const inner = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
        if (inner.error) throw new Error(inner.error);
        return inner as ChatResponse;
      }
    } catch (e: any) {
      if (e.message && !e.message.includes('JSON')) throw e;
    }
    throw new Error('Stream ended without a final response');
  }

  // ── Buffered fallback (non-streaming Lambda) ──────────────────────────────
  const data = await response.json();

  // Unwrap API Gateway proxy format if the Function URL forwarded it as-is
  if (data && typeof data.body === 'string' && data.statusCode) {
    const inner = JSON.parse(data.body);
    if (inner.error) throw new Error(inner.error);
    return inner as ChatResponse;
  }

  if (data?.error) throw new Error(data.error);
  return data as ChatResponse;
}
