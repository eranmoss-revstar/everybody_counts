export interface AgentRequest {
  question: string;
  sessionId?: string;
}

export interface AgentResponse {
  response: string;
  citation?: string | null;
  sessionId?: string | null;
}

const BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export async function queryDocs(
  question: string,
  authToken: string,
  sessionId?: string,
): Promise<AgentResponse> {
  const body: AgentRequest = { question };
  if (sessionId) body.sessionId = sessionId;

  const response = await fetch(`${BASE_URL}/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.response || data.error || `Request failed (${response.status})`);
  }

  return response.json();
}
