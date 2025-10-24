# AgentCore Integration Functions

This directory contains Lambda functions that integrate with the AgentCore QuickStart infrastructure.

## Structure

```
functions/
├── agentcore-integration/
│   ├── index.py              # Main Lambda handler
│   ├── requirements.txt      # Python dependencies
│   └── README.md            # Function documentation
└── README.md                # This file
```

## AgentCore Integration Function

The `agentcore-integration` function serves as a bridge between API Gateway and the AgentCore Runtime. It handles:

- **Request Validation**: Validates incoming API Gateway requests
- **Input Sanitization**: Sanitizes user input for security
- **AgentCore Invocation**: Calls the deployed AgentCore Runtime
- **Response Processing**: Processes and formats responses
- **Error Handling**: Comprehensive error handling and logging

### Key Features

- **Type Safety**: Uses Python type hints for better code quality
- **Comprehensive Logging**: Detailed logging for debugging and monitoring
- **Error Recovery**: Graceful error handling with meaningful error messages
- **CORS Support**: Proper CORS headers for frontend integration
- **Input Validation**: Validates and sanitizes all inputs

### Environment Variables

- `AGENTCORE_RUNTIME_ARN`: The ARN of the deployed AgentCore Runtime
- `REGION`: AWS region (defaults to us-east-1)

### Dependencies

- `boto3`: AWS SDK for Python
- Standard library modules: `json`, `os`, `logging`, `datetime`, `typing`

## Best Practices

1. **Separation of Concerns**: Lambda code is separate from CDK infrastructure code
2. **Proper Bundling**: Dependencies are bundled using CDK's bundling feature
3. **Type Safety**: Uses Python type hints for better maintainability
4. **Error Handling**: Comprehensive error handling with proper HTTP status codes
5. **Logging**: Structured logging for monitoring and debugging
6. **Security**: Input validation and sanitization

## Adding New Functions

To add a new Lambda function:

1. Create a new directory under `functions/`
2. Add `index.py` with the Lambda handler
3. Add `requirements.txt` with dependencies
4. Add the function to the CDK stack using `lambda.Code.fromAsset()`
5. Configure proper IAM permissions
6. Add monitoring and logging

## Testing

Functions can be tested locally using:

```bash
# Test the AgentCore integration function
cd functions/agentcore-integration
python -m pytest  # if you add tests
```

Or test via API Gateway after deployment:

```bash
curl -X POST https://YOUR_API_GATEWAY_URL/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, AgentCore!"}'
```
