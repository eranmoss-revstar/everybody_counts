# AgentCore Development Guide

## Overview

Guide for developing and deploying Bedrock AgentCore agents with tools and memory.

## Project Structure

```
agentcore_agents/
├── app.py                    # Main agent application
├── requirements.txt          # Python dependencies
├── .bedrock_agentcore.yaml   # AgentCore configuration
└── tools/                    # Custom tools (optional)
    ├── __init__.py
    └── web_search.py
```

## Agent Development

### 1. Basic Agent Setup
```python
from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent
from strands.tools import tool

# Initialize AgentCore app
app = BedrockAgentCoreApp()

# Define custom tools
@tool
def calculator(expression: str) -> str:
    """Simple calculator tool."""
    try:
        result = eval(expression)
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {str(e)}"

# Create agent with tools
agent = Agent(
    system_prompt="You are a helpful AI assistant with access to tools.",
    tools=[calculator]
)

@app.entrypoint
def invoke(payload: dict) -> dict:
    """Main agent entrypoint."""
    user_message = payload.get('prompt', 'Hello')
    result = agent(user_message)
    
    return {
        "result": result.message,
        "session_id": payload.get('sessionId', 'default'),
        "status": "success"
    }
```

### 2. Memory Integration
```python
from bedrock_agentcore.memory import MemorySessionManager

def get_short_term_memory(session_id: str) -> str:
    """Get recent conversation context."""
    memory_manager = MemorySessionManager(
        memory_id=f"agentcore-quickstart-{session_id}",
        region_name="us-east-1"
    )
    
    recent_turns = memory_manager.get_last_k_turns(
        actor_id="user",
        session_id=session_id,
        k=3
    )
    
    if recent_turns:
        context = []
        for turn in recent_turns:
            for message in turn:
                role = message.role.value
                content = message.content.get('text', '')
                context.append(f"{role}: {content}")
        return "\n".join(context)
    
    return None

def store_conversation(session_id: str, user_message: str, assistant_response: str):
    """Store conversation in memory."""
    memory_manager = MemorySessionManager(
        memory_id=f"agentcore-quickstart-{session_id}",
        region_name="us-east-1"
    )
    
    memory_manager.add_turns(
        actor_id="user",
        session_id=session_id,
        turns=[{
            "role": "user",
            "content": {"text": user_message}
        }, {
            "role": "assistant",
            "content": {"text": assistant_response}
        }]
    )
```

### 3. External API Integration
```python
import boto3
import json

# Initialize AWS clients
secrets_manager = boto3.client('secretsmanager', region_name='us-east-1')

def get_api_key(secret_name: str) -> str:
    """Get API key from Secrets Manager."""
    response = secrets_manager.get_secret_value(SecretId=secret_name)
    secret_data = json.loads(response['SecretString'])
    return secret_data.get('api_key')

# Set API key for tools
os.environ['TAVILY_API_KEY'] = get_api_key('agentcore/tavily-api-key')
```

## Configuration

### .bedrock_agentcore.yaml
```yaml
default_agent: agentcore_quickstart
agents:
  agentcore_quickstart:
    name: agentcore_quickstart
    entrypoint: app.py
    platform: linux/arm64
    container_runtime: docker
    aws:
      execution_role: arn:aws:iam::ACCOUNT:role/AmazonBedrockAgentCoreSDKRuntime-us-east-1-XXXXX
      account: 'ACCOUNT_ID'
      region: us-east-1
      ecr_repository: ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/bedrock-agentcore-agentcore_quickstart
    memory:
      mode: STM_ONLY
      memory_id: agentcore_quickstart_mem-XXXXX
      event_expiry_days: 30
```

### requirements.txt
```
bedrock-agentcore>=0.1.0
strands-agents>=0.1.0
strands-agents-tools>=0.2.12
boto3>=1.34.0
requests>=2.31.0
PyYAML>=6.0
```

## Deployment

### 1. Configure Agent
```bash
agentcore configure \
    --entrypoint app.py \
    --name agentcore_quickstart \
    --region us-east-1 \
    --non-interactive
```

### 2. Deploy Agent
```bash
agentcore launch
```

### 3. Test Agent
```bash
agentcore invoke '{"prompt": "Calculate 2 + 2"}'
agentcore invoke '{"prompt": "What time is it?"}'
```

## Tool Development

### 1. Simple Tools
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
        """Call external API."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/{endpoint}",
                headers={"Authorization": f"Bearer {self.api_key}"}
            )
            return response.json()
```

## Testing

### 1. Local Testing
```python
# Test individual tools
def test_calculator():
    assert calculator("2 + 2") == "Result: 4"
    assert "Error" in calculator("invalid")

# Test agent
def test_agent():
    response = agent("Calculate 5 * 6")
    assert "30" in response.message
```

### 2. Integration Testing
```bash
# Test with AgentCore CLI
agentcore invoke '{"prompt": "Test message"}'

# Check logs
aws logs tail /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --log-stream-name-prefix "2025/10/24/[runtime-logs]"
```

## Debugging

### 1. Log Analysis
```bash
# Check agent logs
aws logs tail /aws/bedrock-agentcore/runtimes/agentcore_quickstart-XXXXX-DEFAULT \
    --log-stream-name-prefix "2025/10/24/[runtime-logs]" \
    --profile <aws-profile>
```

### 2. Common Issues
- **Tool not recognized**: Check `@tool` decorator
- **Memory errors**: Verify DynamoDB permissions
- **API errors**: Check Secrets Manager configuration
- **Import errors**: Verify requirements.txt

## Best Practices

1. **Error Handling**: Comprehensive try-catch blocks
2. **Input Validation**: Validate all inputs
3. **Logging**: Use structured logging
4. **Testing**: Unit and integration tests
5. **Documentation**: Clear docstrings
6. **Security**: Use Secrets Manager for API keys
7. **Performance**: Monitor execution times
8. **Memory**: Limit context length
