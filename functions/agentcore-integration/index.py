"""
AgentCore Integration Lambda Function
Handles API Gateway requests and forwards them to AgentCore Runtime
"""

import json
import boto3
import os
import logging
from datetime import datetime
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Note: AgentCore Runtime has direct access to Secrets Manager via IAM role
# No need to retrieve Tavily API key here - the agent handles it directly

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Enhanced Lambda handler with comprehensive error handling and validation
    
    Args:
        event: API Gateway event
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    request_id = context.aws_request_id
    logger.info(f"Processing request {request_id}")
    
    try:
        # Input validation
        if not event or not isinstance(event, dict):
            return create_error_response(400, "Invalid event structure", request_id)
        
        # Extract and validate body
        body = event.get('body', '{}')
        if not isinstance(body, str):
            return create_error_response(400, "Invalid body format", request_id)
        
        try:
            body_data = json.loads(body)
        except json.JSONDecodeError as e:
            return create_error_response(400, f"Invalid JSON in body: {str(e)}", request_id)
        
        # Extract and validate user message
        user_message = body_data.get('prompt', 'Hello! How can I help you today?')
        if not isinstance(user_message, str) or len(user_message.strip()) == 0:
            return create_error_response(400, "Invalid prompt: must be a non-empty string", request_id)
        
        # Sanitize input
        user_message = user_message.strip()[:1000]  # Limit length
        
        # Get AgentCore Runtime ARN from environment
        agent_runtime_arn = os.environ.get('AGENTCORE_RUNTIME_ARN', 'TBD')
        
        if agent_runtime_arn == 'TBD':
            return create_error_response(503, 'AgentCore Runtime not deployed yet. Please deploy agent with: agentcore launch', request_id)
        
        # Validate ARN format
        if not agent_runtime_arn.startswith('arn:aws:bedrock-agentcore:'):
            return create_error_response(500, 'Invalid AgentCore Runtime ARN format', request_id)
        
        # AgentCore Runtime handles Tavily API key retrieval directly via IAM role
        
        # Call AgentCore Runtime with retry logic
        try:
            bedrock_agentcore = boto3.client(
                'bedrock-agentcore', 
                region_name=os.environ.get('REGION', 'us-east-1')
            )
            
            payload = json.dumps({
                "prompt": user_message,
                "sessionId": request_id
            }).encode('utf-8')
            
            logger.info(f"Invoking AgentCore Runtime: {agent_runtime_arn}")
            
            response = bedrock_agentcore.invoke_agent_runtime(
                agentRuntimeArn=agent_runtime_arn,
                runtimeSessionId=request_id,
                payload=payload,
                qualifier="DEFAULT"
            )
            
            # Process response with error handling
            agent_response = ""
            if 'response' in response and response['response']:
                for chunk in response['response']:
                    if isinstance(chunk, bytes):
                        agent_response += chunk.decode('utf-8')
                    else:
                        agent_response += str(chunk)
            
            if not agent_response:
                return create_error_response(500, 'Empty response from AgentCore Runtime', request_id)
            
            # Parse response with fallback
            try:
                parsed_response = json.loads(agent_response)
                final_response = parsed_response.get('result', agent_response)
                status = parsed_response.get('status', 'success')
            except json.JSONDecodeError:
                final_response = agent_response
                status = 'success'
            
            logger.info(f"AgentCore Runtime response processed successfully for request {request_id}")
            
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({
                    'response': final_response,
                    'sessionId': request_id,
                    'timestamp': datetime.now().isoformat(),
                    'status': status
                })
            }
            
        except Exception as agentcore_error:
            logger.error(f"AgentCore Runtime error: {str(agentcore_error)}")
            
            # Handle specific AgentCore errors
            error_message = str(agentcore_error)
            if "AccessDenied" in error_message:
                return create_error_response(403, 'Access denied to AgentCore Runtime. Check IAM permissions.', request_id)
            elif "ResourceNotFoundException" in error_message:
                return create_error_response(404, 'AgentCore Runtime not found. Please deploy the agent first.', request_id)
            elif "ThrottlingException" in error_message:
                return create_error_response(429, 'AgentCore Runtime is throttled. Please try again later.', request_id)
            elif "ValidationException" in error_message:
                return create_error_response(400, f'Invalid request to AgentCore Runtime: {error_message}', request_id)
            else:
                return create_error_response(500, f'AgentCore Runtime error: {error_message}', request_id)
        
    except Exception as e:
        logger.error(f"Unexpected error in Lambda: {str(e)}", exc_info=True)
        return create_error_response(500, f'Internal server error: {str(e)}', request_id)

def create_error_response(status_code: int, message: str, request_id: str) -> Dict[str, Any]:
    """Create standardized error response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        'body': json.dumps({
            'error': message,
            'sessionId': request_id,
            'timestamp': datetime.now().isoformat(),
            'status': 'error'
        })
    }
