"""
Web Search Tool for AgentCore
Simple, clean implementation following AWS official patterns
"""

import json
import boto3
import requests
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

class WebSearchTool:
    """
    Web search tool using Tavily API
    Clean, simple implementation following AWS AgentCore patterns
    """
    
    def __init__(self, region: str = 'us-east-1'):
        self.region = region
        try:
            self.secrets_manager = boto3.client('secretsmanager', region_name=region)
        except Exception as e:
            logger.error(f"Failed to initialize Secrets Manager: {str(e)}")
            raise
        self._api_key = None
    
    def _get_api_key(self) -> str:
        """Get Tavily API key from Secrets Manager"""
        if self._api_key is None:
            try:
                response = self.secrets_manager.get_secret_value(
                    SecretId='agentcore/tavily-api-key'
                )
                self._api_key = json.loads(response['SecretString'])['api_key']
            except Exception as e:
                logger.error(f"Failed to get Tavily API key: {str(e)}")
                raise
        return self._api_key
    
    def search(self, query: str, max_results: int = 5) -> List[Dict[str, Any]]:
        """
        Perform web search
        
        Args:
            query: Search query string
            max_results: Maximum number of results to return
            
        Returns:
            List of search results with title, url, content, score
        """
        try:
            api_key = self._get_api_key()
            
            url = "https://api.tavily.com/search"
            payload = {
                "api_key": api_key,
                "query": query,
                "search_depth": "basic",
                "include_answer": True,
                "include_raw_content": False,
                "max_results": max_results,
                "include_domains": [],
                "exclude_domains": []
            }
            
            headers = {"Content-Type": "application/json"}
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            # Format results
            results = []
            for result in data.get('results', []):
                results.append({
                    'title': result.get('title', ''),
                    'url': result.get('url', ''),
                    'content': result.get('content', ''),
                    'score': result.get('score', 0)
                })
            
            # Include answer if available
            if 'answer' in data and data['answer']:
                results.insert(0, {
                    'title': 'Answer',
                    'url': '',
                    'content': data['answer'],
                    'score': 1.0
                })
            
            logger.info(f"Web search completed: {len(results)} results for query: {query}")
            return results
            
        except Exception as e:
            logger.error(f"Web search failed: {str(e)}")
            return [{
                'title': 'Search Error', 
                'url': '', 
                'content': f'Search failed: {str(e)}', 
                'score': 0
            }]

# Global instance for easy access
web_search_tool = WebSearchTool()
