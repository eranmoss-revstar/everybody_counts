import React, { useState } from 'react';
import { Bot, User, AlertCircle, Copy, Check, Table, ChevronDown, ChevronUp } from 'lucide-react';
import { MessageBubbleProps } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { formatMessageContent } from '../utils/formatters';

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isError = message.isError;
  const [copied, setCopied] = useState<boolean>(false);
  const [showDataTable, setShowDataTable] = useState<boolean>(false);
  const { isDarkMode } = useTheme();
  
  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatContent = (content: string): React.ReactNode => {
    // Ensure content is always a string regardless of what comes in
    const safeContent = typeof content === 'string' ? content : String(content ?? '');
    // Apply number formatting first
    const formattedContent = formatMessageContent(safeContent);
    
    // Apply markdown-like formatting
    const lines = formattedContent.split('\n');
    return lines.map((line, lineIndex) => {
        // Handle code blocks
        if (line.trim().startsWith('```') || line.trim().startsWith('`')) {
          return (
            <code key={lineIndex} className={`px-2 py-1 rounded text-sm font-mono ${
              isDarkMode ? 'bg-gray-700/50 text-gray-200' : 'bg-gray-100 text-gray-800'
            }`}>
              {line.replace(/`/g, '')}
            </code>
          );
        }

        // Handle markdown headings (###, ##, #)
        const h3Match = line.match(/^###\s+(.*)/);
        const h2Match = line.match(/^##\s+(.*)/);
        const h1Match = line.match(/^#\s+(.*)/);
        if (h3Match) {
          return <p key={lineIndex} className={`font-semibold mt-3 mb-1 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{h3Match[1].replace(/\*\*/g, '')}</p>;
        }
        if (h2Match) {
          return <p key={lineIndex} className={`font-bold text-base mt-4 mb-1 ${isDarkMode ? 'text-gray-50' : 'text-gray-900'}`}>{h2Match[1].replace(/\*\*/g, '')}</p>;
        }
        if (h1Match) {
          return <p key={lineIndex} className={`font-bold text-lg mt-4 mb-2 ${isDarkMode ? 'text-gray-50' : 'text-gray-900'}`}>{h1Match[1].replace(/\*\*/g, '')}</p>;
        }

        // Handle bullet points
        const bulletMatch = line.match(/^[-*]\s+(.*)/);
        if (bulletMatch) {
          const parts = bulletMatch[1].split(/\*\*(.*?)\*\*/g);
          return (
            <div key={lineIndex} className="flex items-start gap-2 my-0.5">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} />
              <span>{parts.map((p, i) => i % 2 === 1 ? <strong key={i} className="font-semibold">{p}</strong> : p)}</span>
            </div>
          );
        }

        // Handle bold text in regular lines
        const parts = line.split(/\*\*(.*?)\*\*/g);
        const formattedLine = parts.map((part, partIndex) => {
          if (partIndex % 2 === 1) {
            return <strong key={partIndex} className="font-semibold">{part}</strong>;
          }
          return part;
        });

        return (
          <React.Fragment key={lineIndex}>
            {formattedLine}
            {lineIndex < lines.length - 1 && <br />}
          </React.Fragment>
        );
      });
  };

  const handleCopy = async (): Promise<void> => {
    const text = message.content;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const renderDataTable = (data: any[]): React.ReactNode => {
    if (!data || data.length === 0) return null;

    // Get all unique keys from the data
    const keySet = new Set<string>();
    data.forEach(item => {
      Object.keys(item).forEach(key => keySet.add(key));
    });
    const allKeys = Array.from(keySet);
    
    return (
      <div className={`mt-4 border rounded-lg overflow-hidden transition-all duration-300 ${
        isDarkMode 
          ? 'border-gray-600 bg-gray-800/50' 
          : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`flex items-center justify-between p-3 border-b transition-colors duration-300 ${
          isDarkMode 
            ? 'bg-gray-700/50 border-gray-600 text-gray-200' 
            : 'bg-gray-100 border-gray-200 text-gray-700'
        }`}>
          <div className="flex items-center space-x-2">
            <Table className="w-4 h-4" />
            <span className="font-medium text-sm">Query Results ({data.length} rows)</span>
          </div>
          <button
            onClick={() => setShowDataTable(!showDataTable)}
            className={`p-1 rounded transition-colors duration-200 ${
              isDarkMode
                ? 'hover:bg-gray-600 text-gray-300'
                : 'hover:bg-gray-200 text-gray-600'
            }`}
          >
            {showDataTable ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
        
        {showDataTable && (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className={`w-full text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
              <thead className={`sticky top-0 transition-colors duration-300 ${
                isDarkMode 
                  ? 'bg-gray-700 border-gray-600' 
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <tr>
                  {allKeys.map((key, index) => (
                    <th key={index} className={`px-4 py-2 text-left font-medium border-b ${
                      isDarkMode ? 'border-gray-600' : 'border-gray-200'
                    }`}>
                      {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, rowIndex) => (
                  <tr key={rowIndex} className={`transition-colors duration-200 ${
                    isDarkMode 
                      ? 'hover:bg-gray-700/30 border-gray-700' 
                      : 'hover:bg-gray-50 border-gray-100'
                  }`}>
                    {allKeys.map((key, colIndex) => (
                      <td key={colIndex} className={`px-4 py-2 border-b ${
                        isDarkMode ? 'border-gray-700' : 'border-gray-100'
                      }`}>
                        {typeof row[key] === 'number' ? 
                          (key.toLowerCase().includes('revenue') || key.toLowerCase().includes('cost') ? 
                            `$${row[key].toLocaleString()}` : 
                            row[key].toLocaleString()
                          ) : 
                          (row[key] || '-')
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div className={`flex items-start space-x-3 max-w-3xl ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-all duration-300 ${
          isUser 
            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white' 
            : isError 
              ? 'bg-gradient-to-r from-red-500 to-red-600 text-white'
              : isDarkMode
                ? 'bg-gradient-to-r from-gray-600 to-gray-700 text-gray-200'
                : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-600'
        }`}>
          {isUser ? (
            <User className="w-4 h-4" />
          ) : isError ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <Bot className="w-4 h-4" />
          )}
        </div>

        {/* Message Content */}
        <div className={`relative ${isUser ? 'max-w-[85%]' : 'max-w-[85%]'}`}>
          <div className={`chat-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'} relative group transition-all duration-300 ${
            isDarkMode && !isUser
              ? 'bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 text-gray-100'
              : ''
          }`}>
            <div className="prose prose-sm max-w-none select-text cursor-text" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>
              {formatContent(message.content)}
            </div>
            
            {/* Data Table - only show for assistant messages with raw_data */}
            {!isUser && message.metadata?.raw_data && (
              renderDataTable(message.metadata.raw_data)
            )}
            
            {/* SQL Query Display */}
            {!isUser && message.metadata?.sql_query && (
              <div className={`mt-3 p-3 rounded-lg border transition-all duration-300 ${
                isDarkMode 
                  ? 'bg-gray-800/30 border-gray-600 text-gray-300' 
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}>
                <div className="text-xs font-medium mb-1">Generated SQL:</div>
                <code className="text-xs break-all">{message.metadata.sql_query}</code>
              </div>
            )}
            
            {/* KB Sources */}
            {!isUser && message.metadata?.sources && (
              <div className={`mt-2 pt-2 border-t text-xs transition-colors duration-300 ${
                isDarkMode ? 'border-gray-700 text-gray-500' : 'border-gray-100 text-gray-400'
              }`}>
                <span className="font-medium">Sources: </span>
                {message.metadata.sources.join(', ')}
              </div>
            )}

            {/* Timestamp */}
            <div className={`text-xs mt-2 transition-colors duration-300 ${
              isUser
                ? 'text-blue-100'
                : isDarkMode
                  ? 'text-gray-400'
                  : 'text-gray-500'
            }`}>
              {formatTime(message.timestamp)}
            </div>

            {/* Copy button for assistant messages */}
            {!isUser && (
              <div className={`absolute -top-2 -right-2 flex items-center space-x-1 rounded-lg shadow-lg border p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-300 ${
                isDarkMode
                  ? 'bg-gray-700 border-gray-600'
                  : 'bg-white border-gray-200'
              }`}>
                <button
                  onClick={handleCopy}
                  className={`p-1 rounded transition-colors duration-200 ${
                    isDarkMode
                      ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-600'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Copy message"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble; 