# AgentCore Integration Lambda Function

This Lambda function serves as the integration layer between API Gateway and the AgentCore Runtime.

## Purpose

- **API Gateway Integration**: Receives requests from API Gateway
- **AgentCore Invocation**: Calls the deployed AgentCore Runtime
- **Response Processing**: Processes and formats responses for clients
- **Error Handling**: Provides comprehensive error handling and logging

## Function Details

- **Runtime**: Python 3.12
- **Handler**: `index.lambda_handler`
- **Timeout**: 29 seconds (API Gateway limit)
- **Memory**: 512 MB
- **Dependencies**: boto3

## Input/Output

### Input (API Gateway Event)
```json
{
  "body": "{\"prompt\": \"Hello, AgentCore!\"}",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer <token>"
  }
}
```

### Output (API Gateway Response)
```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"response\": \"Agent response\", \"sessionId\": \"...\", \"timestamp\": \"...\", \"status\": \"success\"}"
}
```

## Environment Variables

- `AGENTCORE_RUNTIME_ARN`: ARN of the deployed AgentCore Runtime
- `REGION`: AWS region (defaults to us-east-1)

## Error Handling

The function handles various error scenarios:

- **400 Bad Request**: Invalid input or malformed requests
- **503 Service Unavailable**: AgentCore Runtime not deployed
- **500 Internal Server Error**: Unexpected errors

## Security Features

- **Input Validation**: Validates all incoming data
- **Input Sanitization**: Sanitizes user input (length limits, etc.)
- **ARN Validation**: Validates AgentCore Runtime ARN format
- **Error Sanitization**: Prevents sensitive information leakage

## Monitoring

The function includes comprehensive logging:

- Request/response logging
- Error logging with stack traces
- Performance metrics
- AgentCore Runtime interaction logs

## Dependencies

- `boto3`: AWS SDK for Python
- Standard library: `json`, `os`, `logging`, `datetime`, `typing`
