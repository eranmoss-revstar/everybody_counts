# Best Practices Guide

## Architecture Best Practices

### 1. Modular Design
```python
# Separate concerns
# tools/calculator.py
@tool
def calculator(expression: str) -> str:
    """Calculator tool."""
    pass

# tools/database.py
class DatabaseTool:
    @tool
    def query_customers(self, search_term: str) -> str:
        """Database tool."""
        pass
```

### 2. Configuration Management
```python
# Use environment variables
import os

AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
TAVILY_API_KEY = os.environ.get('TAVILY_API_KEY')

# Use AWS Secrets Manager for sensitive data
def get_secret(secret_name: str) -> str:
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_name)
    return response['SecretString']
```

### 3. Error Handling
```python
@tool
def robust_tool(input_data: str) -> str:
    """Tool with comprehensive error handling."""
    try:
        result = process_data(input_data)
        return json.dumps(result, indent=2)
    except ValidationError as e:
        logger.warning(f"Validation error: {e}")
        return f"Input validation failed: {str(e)}"
    except ConnectionError as e:
        logger.error(f"Connection error: {e}")
        return "Service temporarily unavailable. Please try again later."
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return "An unexpected error occurred. Please contact support."
```

## Security Best Practices

### 1. IAM Least Privilege
```yaml
# CDK Stack - Minimal permissions
AgentCorePolicy:
  statements:
    - effect: Allow
      actions:
        - bedrock-agentcore:InvokeAgentRuntime
      resources: ["arn:aws:bedrock-agentcore:*:*:runtime/*"]
    - effect: Allow
      actions:
        - secretsmanager:GetSecretValue
      resources: ["arn:aws:secretsmanager:*:*:secret:agentcore/*"]
```

### 2. Input Validation
```python
from pydantic import BaseModel, validator
import re

class ToolInput(BaseModel):
    query: str
    limit: int = 10
    
    @validator('query')
    def validate_query(cls, v):
        if len(v.strip()) < 2:
            raise ValueError('Query must be at least 2 characters')
        if len(v) > 1000:
            raise ValueError('Query too long')
        # Sanitize input
        v = re.sub(r'[<>"\']', '', v)
        return v.strip()
    
    @validator('limit')
    def validate_limit(cls, v):
        if v < 1 or v > 100:
            raise ValueError('Limit must be between 1 and 100')
        return v
```

### 3. Secrets Management
```python
# Never hardcode secrets
# BAD
api_key = "sk-1234567890abcdef"

# GOOD
def get_api_key():
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId='agentcore/api-key')
    return response['SecretString']
```

## Performance Best Practices

### 1. Async Operations
```python
import asyncio
import httpx

class APITool:
    def __init__(self):
        self.client = httpx.AsyncClient()
    
    @tool
    async def call_external_api(self, endpoint: str) -> str:
        """Async API call."""
        try:
            response = await self.client.get(f"{self.base_url}/{endpoint}")
            return response.json()
        finally:
            await self.client.aclose()
```

### 2. Caching
```python
from functools import lru_cache
import redis

class CachedTool:
    def __init__(self):
        self.redis_client = redis.Redis(host='localhost', port=6379)
    
    @tool
    def cached_search(self, query: str) -> str:
        """Tool with Redis caching."""
        cache_key = f"search:{hash(query)}"
        
        # Check cache
        cached_result = self.redis_client.get(cache_key)
        if cached_result:
            return cached_result.decode('utf-8')
        
        # Perform search
        result = perform_search(query)
        
        # Cache for 1 hour
        self.redis_client.setex(cache_key, 3600, result)
        return result
```

### 3. Resource Management
```python
class DatabaseTool:
    def __init__(self):
        self.connection_pool = None
    
    def get_connection(self):
        """Get connection from pool."""
        if not self.connection_pool:
            self.connection_pool = create_connection_pool()
        return self.connection_pool.get_connection()
    
    @tool
    def query_database(self, query: str) -> str:
        """Database query with proper resource management."""
        conn = None
        try:
            conn = self.get_connection()
            with conn.cursor() as cursor:
                cursor.execute(query)
                return json.dumps(cursor.fetchall(), indent=2)
        finally:
            if conn:
                conn.close()
```

## Monitoring Best Practices

### 1. Structured Logging
```python
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

def log_agent_invocation(session_id: str, user_message: str, response: str, execution_time: float):
    """Structured logging for agent invocations."""
    log_entry = {
        'timestamp': datetime.now().isoformat(),
        'session_id': session_id,
        'user_message_length': len(user_message),
        'response_length': len(response),
        'execution_time_ms': execution_time,
        'event_type': 'agent_invocation'
    }
    
    logger.info(json.dumps(log_entry))
```

### 2. Custom Metrics
```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def log_custom_metrics(namespace: str, metric_name: str, value: float, dimensions: dict = None):
    """Log custom CloudWatch metrics."""
    metric_data = {
        'MetricName': metric_name,
        'Value': value,
        'Unit': 'Count'
    }
    
    if dimensions:
        metric_data['Dimensions'] = [
            {'Name': k, 'Value': v} for k, v in dimensions.items()
        ]
    
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=[metric_data]
    )
```

### 3. Health Checks
```python
def health_check():
    """Comprehensive health check."""
    health_status = {
        'timestamp': datetime.now().isoformat(),
        'status': 'healthy',
        'checks': {}
    }
    
    # Check database
    try:
        db_conn = get_database_connection()
        health_status['checks']['database'] = 'healthy'
    except Exception as e:
        health_status['checks']['database'] = f'unhealthy: {str(e)}'
        health_status['status'] = 'unhealthy'
    
    # Check external APIs
    try:
        test_api_connection()
        health_status['checks']['external_apis'] = 'healthy'
    except Exception as e:
        health_status['checks']['external_apis'] = f'unhealthy: {str(e)}'
        health_status['status'] = 'unhealthy'
    
    return health_status
```

## Testing Best Practices

### 1. Unit Tests
```python
import pytest
from unittest.mock import Mock, patch

def test_calculator():
    """Test calculator tool."""
    assert calculator("2 + 2") == "Result: 4"
    assert "Error" in calculator("invalid expression")

def test_database_tool():
    """Test database tool with mocking."""
    with patch('tools.database.get_database_connection') as mock_conn:
        mock_cursor = Mock()
        mock_cursor.fetchall.return_value = [{'id': 1, 'name': 'John'}]
        mock_conn.return_value.cursor.return_value.__enter__.return_value = mock_cursor
        
        db_tool = DatabaseTool()
        result = db_tool.query_customers("John")
        
        assert "John" in result
```

### 2. Integration Tests
```python
@pytest.mark.asyncio
async def test_agent_integration():
    """Test complete agent integration."""
    # Test with mock external services
    with patch('tools.external_api.call_api') as mock_api:
        mock_api.return_value = {"result": "test"}
        
        response = await agent.invoke("Test message")
        assert "test" in response
```

### 3. Load Testing
```python
import asyncio
import time

async def load_test_agent(concurrent_requests: int = 10):
    """Load test the agent."""
    async def single_request():
        start_time = time.time()
        response = await agent.invoke("Load test message")
        return time.time() - start_time
    
    tasks = [single_request() for _ in range(concurrent_requests)]
    execution_times = await asyncio.gather(*tasks)
    
    avg_time = sum(execution_times) / len(execution_times)
    max_time = max(execution_times)
    
    print(f"Average execution time: {avg_time:.2f}s")
    print(f"Max execution time: {max_time:.2f}s")
```

## Deployment Best Practices

### 1. Blue-Green Deployment
```bash
# Deploy to staging first
./deploy-agentcore.sh <staging-client-name> <aws-profile>

# Test staging environment
agentcore invoke '{"prompt": "test"}' --environment staging

# Deploy to production
./deploy-agentcore.sh <production-client-name> <aws-profile>
```

### 2. Rollback Strategy
```bash
# Keep previous version
agentcore launch --version previous

# Quick rollback if needed
agentcore delete agentcore_quickstart
agentcore launch --version previous
```

### 3. Environment Separation
```yaml
# environments/production.yaml
region: us-east-1
memory_retention_days: 30
log_level: INFO
max_concurrent_requests: 100

# environments/staging.yaml
region: us-east-1
memory_retention_days: 7
log_level: DEBUG
max_concurrent_requests: 10
```

## Code Quality Best Practices

### 1. Type Hints
```python
from typing import Dict, List, Optional, Union

def process_data(
    input_data: str,
    options: Optional[Dict[str, Union[str, int]]] = None
) -> Dict[str, str]:
    """Function with proper type hints."""
    if options is None:
        options = {}
    
    result = {"status": "success", "data": input_data}
    return result
```

### 2. Documentation
```python
def complex_tool(
    query: str,
    limit: int = 10,
    include_metadata: bool = False
) -> str:
    """
    Complex tool with comprehensive documentation.
    
    Args:
        query: Search query string (2-1000 characters)
        limit: Maximum number of results (1-100)
        include_metadata: Whether to include metadata in response
    
    Returns:
        JSON string containing search results
        
    Raises:
        ValidationError: If input validation fails
        ConnectionError: If external service is unavailable
        
    Example:
        >>> result = complex_tool("test query", limit=5)
        >>> print(result)
        '{"results": [...], "count": 5}'
    """
    pass
```

### 3. Code Organization
```
agentcore_agents/
├── app.py                 # Main application
├── tools/                 # Tool modules
│   ├── __init__.py
│   ├── calculator.py
│   ├── database.py
│   └── external_api.py
├── utils/                 # Utility functions
│   ├── __init__.py
│   ├── logging.py
│   └── validation.py
├── tests/                 # Test modules
│   ├── __init__.py
│   ├── test_tools.py
│   └── test_integration.py
└── requirements.txt       # Dependencies
```

## Operational Best Practices

### 1. Incident Response
```bash
# Quick health check
./scripts/health-check.sh

# Emergency rollback
./scripts/emergency-rollback.sh

# Scale down if needed
aws lambda put-provisioned-concurrency-config \
    --function-name AgentCoreIntegrationLambda \
    --provisioned-concurrency-config ProvisionedConcurrencyConfig='{ProvisionedConcurrencyCount=0}'
```

### 2. Regular Maintenance
```bash
# Weekly log cleanup
aws logs delete-log-group --log-group-name /aws/lambda/OldFunction

# Monthly security audit
aws iam get-account-summary

# Quarterly performance review
aws cloudwatch get-metric-statistics --namespace "AgentCore/Performance"
```

### 3. Backup Strategy
```bash
# Backup DynamoDB table
aws dynamodb create-backup \
    --table-name agentcore-memory \
    --backup-name agentcore-memory-$(date +%Y%m%d)

# Backup Lambda function
aws lambda get-function --function-name AgentCoreIntegrationLambda > backup.json
```

## Summary

1. **Design for Scale**: Use modular, async patterns
2. **Security First**: Implement least privilege and input validation
3. **Monitor Everything**: Comprehensive logging and metrics
4. **Test Thoroughly**: Unit, integration, and load tests
5. **Deploy Safely**: Blue-green deployments with rollback
6. **Document Clearly**: Code, APIs, and procedures
7. **Operate Proactively**: Regular maintenance and monitoring
8. **Plan for Failure**: Backup, recovery, and incident response
