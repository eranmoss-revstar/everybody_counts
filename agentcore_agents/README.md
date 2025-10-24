# AgentCore QuickStart - Clean Implementation

Simple, clean AgentCore implementation following [official AWS patterns](https://github.com/awslabs/amazon-bedrock-agentcore-samples).

## 🏗️ Architecture

```
agentcore_agents/
├── app.py              # Main agent with multi-agent workflow
├── tools/              # Simple tool implementations
│   ├── __init__.py
│   ├── web_search.py   # Web search tool
│   └── README.md
├── requirements.txt    # Dependencies
└── README.md          # This file
```

## 🤖 Agents

- **Research Agent**: Web search and information gathering
- **Analysis Agent**: Data analysis and insights
- **Coordinator Agent**: Orchestrates other agents

## 🔧 Tools

- **Web Search**: Tavily API integration for real-time information

## 🚀 Usage

```python
# Main entrypoint
@app.entrypoint
def invoke(payload: Dict[str, Any]) -> Dict[str, Any]:
    # Simple, clean agent logic
    return {"result": response}
```

## 📋 Key Features

- ✅ **Simple** - Easy to understand and maintain
- ✅ **Clean** - Follows official AWS patterns
- ✅ **Multi-Agent** - Research, Analysis, Coordinator
- ✅ **Memory** - AgentCore Memory integration
- ✅ **Tools** - Direct tool integration (no Lambda needed)
- ✅ **Official** - Based on AWS samples repository

## 🔄 Flow

1. **User Message** → Agent receives prompt
2. **Agent Selection** → Determine which agents to use
3. **Tool Usage** → Research agent uses web search
4. **Response Generation** → Combine agent responses
5. **Memory Storage** → Store conversation in AgentCore Memory

This is the **clean, official approach** for AgentCore! 🎉
