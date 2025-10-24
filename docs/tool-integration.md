# Tool Integration Guide

## Overview

Guide for integrating custom tools and external APIs with Bedrock AgentCore agents.

## Tool Registration

### Basic Pattern
```python
from strands.tools import tool

@tool
def calculator(expression: str) -> str:
    """Simple calculator for mathematical expressions."""
    try:
        result = eval(expression)
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {str(e)}"

# Register with agent
agent = Agent(
    system_prompt="...",
    tools=[tavily.tavily_search, calculator]
)
```

## Tool Types

### 1. Simple Functions
```python
@tool
def get_current_time() -> str:
    """Get current date and time."""
    from datetime import datetime
    return f"Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}"
```

### 2. Database Tools
```python
import pymysql

class DatabaseTool:
    def __init__(self, connection_string: str):
        self.connection = pymysql.connect(connection_string)
    
    @tool
    def query_customers(self, search_term: str) -> str:
        """Search customer records."""
        with self.connection.cursor() as cursor:
            cursor.execute("SELECT * FROM customers WHERE name LIKE %s", (f"%{search_term}%",))
            return json.dumps(cursor.fetchall(), indent=2)
```

### 3. External API Tools
```python
import httpx

class APITool:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
    
    @tool
    async def call_external_api(self, endpoint: str) -> str:
        """Call external API endpoint."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/{endpoint}",
                headers={"Authorization": f"Bearer {self.api_key}"}
            )
            return response.json()
```

### 4. Knowledge Base Tools
```python
from opensearchpy import OpenSearch

class KnowledgeBaseTool:
    def __init__(self):
        self.client = OpenSearch([{'host': os.environ['OPENSEARCH_HOST']}])
    
    @tool
    def search_documents(self, query: str) -> str:
        """Search enterprise knowledge base."""
        response = self.client.search(
            index="knowledge_base",
            body={"query": {"multi_match": {"query": query}}}
        )
        return json.dumps(response['hits']['hits'], indent=2)
```

## Error Handling

```python
@tool
def robust_tool(input_data: str) -> str:
    """Tool with comprehensive error handling."""
    try:
        result = process_data(input_data)
        return json.dumps(result, indent=2)
    except ValidationError as e:
        return f"Validation error: {str(e)}"
    except ConnectionError as e:
        return f"Connection error: {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return f"Tool error: {str(e)}"
```

## Input Validation

```python
from pydantic import BaseModel, validator

class ToolInput(BaseModel):
    query: str
    limit: int = 10
    
    @validator('query')
    def validate_query(cls, v):
        if len(v.strip()) < 2:
            raise ValueError('Query must be at least 2 characters')
        return v.strip()

@tool
def validated_tool(input_data: str) -> str:
    """Tool with input validation."""
    try:
        data = ToolInput.parse_raw(input_data)
        return process_validated_data(data)
    except ValidationError as e:
        return f"Input validation error: {str(e)}"
```

## Configuration

### Environment Variables
```bash
# .env
RDS_HOST=your-rds-host.amazonaws.com
RDS_USER=admin
RDS_PASSWORD=your-password
OPENSEARCH_HOST=your-opensearch-host
API_KEY=your-api-key
```

### IAM Permissions
```yaml
# CDK Stack
AgentCoreToolPolicy:
  statements:
    - effect: Allow
      actions:
        - rds:Connect
        - es:ESHttpGet
        - secretsmanager:GetSecretValue
      resources: ["*"]
```

## Testing

### Unit Tests
```python
def test_calculator():
    assert calculator("2 + 2") == "Result: 4"
    assert "Error" in calculator("invalid expression")

def test_database_tool():
    db_tool = DatabaseTool("test-connection")
    result = db_tool.query_customers("John")
    assert "customer" in result.lower()
```

### Integration Tests
```python
@pytest.mark.asyncio
async def test_agent_with_tools():
    response = await agent.invoke("Calculate 5 * 6")
    assert "30" in response
```

## Best Practices

1. **Modular Design**: Keep tools in separate modules
2. **Error Handling**: Comprehensive error handling
3. **Input Validation**: Validate all inputs
4. **Logging**: Log tool execution
5. **Testing**: Unit and integration tests
6. **Documentation**: Clear docstrings
7. **Security**: Use IAM roles and secrets management
8. **Performance**: Monitor execution times
