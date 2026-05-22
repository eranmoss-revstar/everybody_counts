// Mock API Service for Template
// Replace with your actual API endpoints

export interface QueryRequest {
  query: string;
  user_context: {
    tenant_id: string;
    user_id: string;
    session_id: string;
  };
}

export interface QueryResponse {
  success: boolean;
  answer: string;
  data_summary?: string;
  approach: string;
  follow_up_suggestions: string[];
  processing_time_ms: number;
}

class MockApiService {
  private baseUrl = 'YOUR_API_ENDPOINT_HERE'; // Replace with your actual API endpoint

  // Mock responses for demo
  private mockResponses = [
    {
      success: true,
      answer: "Based on your query, here's a sample response. This is a template UI - connect your actual API endpoint to see real data.",
      data_summary: "Sample data summary for demonstration",
      approach: "mock_response",
      follow_up_suggestions: [
        "Try asking about different topics",
        "Explore various query types",
        "Test the chat functionality"
      ],
      processing_time_ms: 150
    },
    {
      success: true,
      answer: "This is another sample response to show how the chat interface works. Replace the mockApi.ts file with your actual API integration.",
      data_summary: "Mock analytics data",
      approach: "template_demo",
      follow_up_suggestions: [
        "What other features are available?",
        "How do I customize this interface?",
        "Where do I add my API endpoint?"
      ],
      processing_time_ms: 200
    }
  ];

  private responseIndex = 0;

  async query(request: QueryRequest): Promise<QueryResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Return mock responses in rotation
    const response = this.mockResponses[this.responseIndex % this.mockResponses.length];
    this.responseIndex++;

    return response;
  }

  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    // Mock health check
    return {
      status: 'Template Mode - Replace with your API',
      timestamp: new Date().toISOString()
    };
  }
}

const mockApiService = new MockApiService();
export default mockApiService;