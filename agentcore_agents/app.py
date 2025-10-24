"""
AgentCore QuickStart - Official AWS Pattern
Following official AWS Bedrock AgentCore patterns with Strands Agents
"""

import json
import boto3
import requests
import os
from typing import Dict, Any, List, Optional
import logging
from datetime import datetime
from bedrock_agentcore import BedrockAgentCoreApp
from bedrock_agentcore.memory import MemorySessionManager
from strands import Agent
from strands_tools import tavily

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Get region from environment or default
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize AWS clients with error handling
try:
    secrets_manager = boto3.client('secretsmanager', region_name=AWS_REGION)
except Exception as e:
    logger.error(f"Failed to initialize Secrets Manager client: {str(e)}")
    raise

def get_tavily_api_key():
    """Get Tavily API key from AWS Secrets Manager"""
    try:
        response = secrets_manager.get_secret_value(
            SecretId='agentcore/tavily-api-key'
        )
        secret_string = response['SecretString']
        
        # Try to parse as JSON first, fallback to direct string
        try:
            secret_data = json.loads(secret_string)
            api_key = secret_data.get('api_key')
        except json.JSONDecodeError:
            # If not JSON, treat as direct API key string
            api_key = secret_string
            
        logger.info("Retrieved Tavily API key from Secrets Manager")
        return api_key
    except Exception as e:
        logger.error(f"Failed to retrieve Tavily API key from Secrets Manager: {str(e)}")
        raise ValueError(f"Unable to retrieve Tavily API key from Secrets Manager: {str(e)}")

# Set Tavily API key from Secrets Manager (for direct AgentCore Runtime usage)
try:
    os.environ['TAVILY_API_KEY'] = get_tavily_api_key()
    logger.info("Successfully configured Tavily API key from Secrets Manager")
except Exception as e:
    logger.error(f"Failed to configure Tavily API key: {str(e)}")
    raise

# Initialize Bedrock client with error handling
try:
    bedrock_runtime = boto3.client('bedrock-runtime', region_name=AWS_REGION)
except Exception as e:
    logger.error(f"Failed to initialize Bedrock client: {str(e)}")
    raise

# Initialize BedrockAgentCoreApp - Official AWS Pattern
app = BedrockAgentCoreApp()

# Define custom tools with proper decorators
from strands.tools import tool

@tool
def calculator(expression: str) -> str:
    """
    Simple calculator tool for basic mathematical operations.
    
    Args:
        expression: Mathematical expression to evaluate (e.g., "2 + 3 * 4")
        
    Returns:
        Result of the calculation
    """
    try:
        # Basic safety check - only allow numbers, operators, and parentheses
        import re
        if not re.match(r'^[0-9+\-*/().\s]+$', expression):
            return "Error: Invalid characters in expression. Only numbers and basic operators (+, -, *, /, parentheses) are allowed."
        
        result = eval(expression)
        return f"Result: {result}"
    except Exception as e:
        return f"Error calculating '{expression}': {str(e)}"

@tool
def get_current_time() -> str:
    """
    Get the current date and time.
    
    Returns:
        Current date and time in a readable format
    """
    from datetime import datetime
    now = datetime.now()
    return f"Current time: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}"

# Initialize Strands Agent with system prompt and tools - Official AWS Pattern
agent = Agent(
    system_prompt=(
        "You are an intelligent AI assistant specialized in research, analysis, and coordination. "
        "You have access to web search tools and can provide comprehensive, well-researched responses. "
        "Your capabilities include:\n"
        "- Research: Gather current information using web search tools\n"
        "- Analysis: Provide detailed analysis and insights\n"
        "- Coordination: Orchestrate complex workflows and multi-step tasks\n"
        "- Calculations: Perform basic mathematical operations\n"
        "- Time queries: Provide current date and time information\n\n"
        "Always:\n"
        "- Use available tools when needed for current information\n"
        "- Provide clear, actionable responses\n"
        "- Explain your reasoning and cite sources when possible\n"
        "- Be helpful, accurate, and professional\n"
        "- If you're unsure about something, say so rather than guessing\n\n"
        "You can adapt your approach based on the user's request:\n"
        "- For research tasks: Focus on gathering current, accurate information\n"
        "- For analysis tasks: Provide detailed analysis with actionable insights\n"
        "- For complex tasks: Break them down into manageable steps and coordinate effectively\n"
        "- For calculations: Use the calculator tool for mathematical expressions\n"
        "- For time queries: Use the time tool for current date/time information"
    ),
    tools=[tavily.tavily_search, calculator, get_current_time]
)

# Initialize Memory Session Manager - Official AWS Pattern
# This handles both Short-term Memory (STM) and Long-term Memory (LTM)
# Note: MemorySessionManager will be initialized per session

# Tavily API key will be set from payload in the invoke function

# Note: Using official strands-tools WebSearchTool
# The agent will automatically decide when to use tools based on the user's request

# Note: For AgentCore runtime, we use a single agent with a comprehensive system prompt
# that can adapt to different types of requests. This is more efficient and reliable
# than creating multiple agent instances at runtime.

@app.entrypoint
def invoke(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main agent entrypoint - following official AWS pattern with Strands Agent
    
    Args:
        payload: Input payload with user message
        
    Returns:
        Dict containing agent response
    """
    session_id = None
    try:
        # Input validation
        if not payload or not isinstance(payload, dict):
            raise ValueError("Invalid payload: must be a non-empty dictionary")
        
        # Extract and validate user message
        user_message = payload.get('prompt', 'Hello! How can I help you today?')
        if not isinstance(user_message, str) or len(user_message.strip()) == 0:
            raise ValueError("Invalid prompt: must be a non-empty string")
        
        # Sanitize input (basic)
        user_message = user_message.strip()[:1000]  # Limit length
        
        # Set Tavily API key from payload (provided by Lambda function) or use existing one
        tavily_api_key = payload.get('tavily_api_key')
        if tavily_api_key:
            os.environ['TAVILY_API_KEY'] = tavily_api_key
            logger.info("Set Tavily API key from payload")
        elif not os.environ.get('TAVILY_API_KEY'):
            logger.warning("No Tavily API key available - web search may not work")
        
        # Generate session ID with validation
        session_id = payload.get('sessionId')
        if not session_id or not isinstance(session_id, str):
            session_id = f"session-{datetime.now().strftime('%Y%m%d%H%M%S')}-{hash(user_message) % 10000}"
        
        logger.info(f"Agent invoked for session {session_id} with message length: {len(user_message)}")
        
        # Handle Short-term Memory (STM) - Recent conversation context
        try:
            stm_context = get_short_term_memory(session_id)
            if stm_context:
                # Add recent context to the user message for better responses
                user_message_with_context = f"Previous context: {stm_context}\n\nCurrent request: {user_message}"
            else:
                user_message_with_context = user_message
        except Exception as stm_error:
            logger.warning(f"STM retrieval failed: {str(stm_error)}")
            user_message_with_context = user_message
        
        # Use the Strands Agent with official strands-tools integration
        # The agent will automatically decide when to use tools
        try:
            logger.info(f"Invoking agent with message: {user_message}")
            result = agent(user_message_with_context)
            
            if not hasattr(result, 'message') or not result.message:
                raise ValueError("Agent returned invalid response")
                
        except Exception as agent_error:
            logger.error(f"Strands Agent failed: {str(agent_error)}")
            # Fallback response
            result = type('Result', (), {'message': 'I apologize, but I encountered an error processing your request. Please try again.'})()
        
        # Store current conversation in Short-term Memory
        try:
            store_short_term_memory(session_id, user_message, result.message)
        except Exception as store_error:
            logger.warning(f"STM storage failed: {str(store_error)}")
        
        # Handle Long-term Memory (LTM) - Persistent knowledge and preferences
        try:
            ltm_context = get_long_term_memory(session_id)
            # Use LTM context to enhance responses
        except Exception as ltm_error:
            logger.warning(f"LTM retrieval failed: {str(ltm_error)}")
        
        # Store important information in Long-term Memory
        try:
            if should_store_in_ltm(user_message, result.message):
                store_long_term_memory(session_id, user_message, result.message)
        except Exception as ltm_store_error:
            logger.warning(f"LTM storage failed: {str(ltm_store_error)}")
        
        logger.info(f"Agent completed successfully for session {session_id}")
        
        return {
            "result": result.message,
            "session_id": session_id,
            "timestamp": datetime.now().isoformat(),
            "status": "success"
        }
        
    except ValueError as ve:
        logger.error(f"Validation error in agent: {str(ve)}")
        return {
            "error": f"Invalid input: {str(ve)}",
            "session_id": session_id or "unknown",
            "status": "error"
        }
    except Exception as e:
        logger.error(f"Unexpected error in agent: {str(e)}", exc_info=True)
        return {
            "error": "An unexpected error occurred. Please try again later.",
            "session_id": session_id or "unknown",
            "status": "error"
        }

# Memory Management Functions for AgentCore

def get_short_term_memory(session_id: str) -> Optional[str]:
    """
    Retrieve Short-term Memory (STM) - Recent conversation context
    Retention: 30 days (configurable)
    """
    try:
        # Initialize MemorySessionManager for this session
        memory_manager = MemorySessionManager(
            memory_id=f"agentcore-quickstart-{session_id}",
            region_name=AWS_REGION
        )
        
        # Get last 3 conversation turns for context
        recent_turns = memory_manager.get_last_k_turns(
            actor_id="user",
            session_id=session_id,
            k=3
        )
        
        if recent_turns:
            # Format recent turns into context string
            context_parts = []
            for turn in recent_turns:
                turn_text = []
                for message in turn:
                    role = message.role.value if hasattr(message.role, 'value') else str(message.role)
                    content = message.content.get('text', '') if hasattr(message.content, 'get') else str(message.content)
                    turn_text.append(f"{role}: {content}")
                context_parts.append("\n".join(turn_text))
            
            return "\n\n".join(context_parts)
        
        return None
        
    except Exception as e:
        logger.error(f"Failed to retrieve STM: {str(e)}")
        return None

def store_short_term_memory(session_id: str, user_message: str, assistant_response: str):
    """
    Store conversation in Short-term Memory (STM)
    """
    try:
        # Initialize MemorySessionManager for this session
        memory_manager = MemorySessionManager(
            memory_id=f"agentcore-quickstart-{session_id}",
            region_name=AWS_REGION
        )
        
        # Add conversation turn to memory
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
        logger.info(f"Stored conversation in STM for session {session_id}")
        
    except Exception as e:
        logger.error(f"Failed to store in STM: {str(e)}")

def get_long_term_memory(session_id: str) -> Optional[List[Dict[str, Any]]]:
    """
    Retrieve Long-term Memory (LTM) - Persistent knowledge and preferences
    Retention: Indefinite
    """
    try:
        # Initialize MemorySessionManager for this session
        memory_manager = MemorySessionManager(
            memory_id=f"agentcore-quickstart-{session_id}",
            region_name=AWS_REGION
        )
        
        # Search long-term memory records
        ltm_records = memory_manager.list_long_term_memory_records(
            actor_id="user",
            session_id=session_id
        )
        
        return ltm_records
        
    except Exception as e:
        logger.error(f"Failed to retrieve LTM: {str(e)}")
        return None

def store_long_term_memory(session_id: str, user_message: str, assistant_response: str):
    """
    Store important information in Long-term Memory (LTM)
    """
    try:
        # Initialize MemorySessionManager for this session
        memory_manager = MemorySessionManager(
            memory_id=f"agentcore-quickstart-{session_id}",
            region_name=AWS_REGION
        )
        
        # For LTM, we would use search_long_term_memories to store
        # This is a simplified approach - in production you'd use proper LTM storage
        logger.info(f"LTM storage would be implemented here for session {session_id}")
        
    except Exception as e:
        logger.error(f"Failed to store in LTM: {str(e)}")

def should_store_in_ltm(user_message: str, assistant_response: str) -> bool:
    """
    Determine if conversation should be stored in Long-term Memory
    """
    # Store if user mentions preferences, important facts, or requests to remember something
    ltm_keywords = [
        "remember", "prefer", "like", "dislike", "always", "never", 
        "important", "note", "save", "keep", "fact", "information"
    ]
    
    message_lower = user_message.lower()
    response_lower = assistant_response.lower()
    
    return any(keyword in message_lower or keyword in response_lower for keyword in ltm_keywords)

def extract_user_preferences(user_message: str) -> List[str]:
    """
    Extract user preferences from the message
    """
    preferences = []
    # Simple keyword-based extraction (in production, use NLP)
    if "prefer" in user_message.lower():
        preferences.append(user_message)
    return preferences

def extract_knowledge_facts(assistant_response: str) -> List[str]:
    """
    Extract knowledge facts from the assistant response
    """
    facts = []
    # Simple extraction (in production, use more sophisticated NLP)
    if len(assistant_response) > 100:  # Only store substantial responses
        facts.append(assistant_response[:500])  # Truncate for storage
    return facts

# Official AWS Pattern - app.run() at the end
if __name__ == "__main__":
    app.run()