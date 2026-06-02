import React, { useState, useRef, useEffect } from 'react';
import ecLogo from '../assets/ec-logo.png';
import { Send, Menu, StopCircle, ChevronDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import { ChatInterfaceProps } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { queryChat } from '../services/chatService';
import sessionManager from '../utils/sessionManager';

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  session,
  onUpdateSession,
  onToggleSidebar,
  pendingMessage,
  onClearPendingMessage,
}) => {
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isDarkMode } = useTheme();
  const { getIdToken } = useAuth();

  useEffect(() => {
    if (pendingMessage && session && !isLoading) {
      onClearPendingMessage?.();
      handleSendMessage(pendingMessage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage, session?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom && (session?.messages?.length || 0) > 0);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [session?.messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
    }
  }, [inputMessage]);

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setIsTyping(true), 500);
      return () => clearTimeout(timer);
    } else {
      setIsTyping(false);
    }
  }, [isLoading]);

  const handleSendMessage = async (overrideMessage?: string): Promise<void> => {
    const text = (overrideMessage || inputMessage).trim();
    if (!text || !session || isLoading) return;

    sessionManager.extendSession();

    const userMessage = {
      id: Date.now().toString(),
      content: text,
      role: 'user' as const,
      timestamp: new Date().toISOString()
    };

    const updatedMessages = [...session.messages, userMessage];
    onUpdateSession(session.id, {
      messages: updatedMessages,
      title: session.messages.length === 0 ? text.substring(0, 50) : session.title
    });

    setInputMessage('');
    setSuggestedQuestions([]);
    setProgressMessage('');
    setIsLoading(true);

    try {
      const history = session.messages.map(m => ({ role: m.role, content: m.content }));
      const data = await queryChat(
        userMessage.content,
        getIdToken(),
        history,
        session.id,
        (msg) => setProgressMessage(msg),
      );
      setSuggestedQuestions(data.followUpSuggestions);

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        content: data.response,
        role: 'assistant' as const,
        timestamp: new Date().toISOString(),
        metadata: {
          source: data.citation ?? undefined,
          sources: data.sources && data.sources.length > 0 ? data.sources : undefined,
        },
      };

      onUpdateSession(session.id, {
        messages: [...updatedMessages, assistantMessage],
      });

    } catch (error: any) {
      console.error('Error sending message:', error);

      const errorMessage = {
        id: (Date.now() + 1).toString(),
        content: error.message || 'Something went wrong. Please try again.',
        role: 'assistant' as const,
        timestamp: new Date().toISOString(),
        isError: true,
      };

      onUpdateSession(session.id, {
        messages: [...updatedMessages, errorMessage],
      });
    } finally {
      setIsLoading(false);
      setProgressMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!session) {
    return (
      <div className={`flex-1 flex items-center justify-center transition-colors duration-500 ${
        isDarkMode
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900'
          : 'bg-gradient-to-br from-slate-50 via-white to-slate-50'
      }`}>
        <div className="text-center max-w-md mx-auto px-6 animate-fade-in">
          <img
            src={ecLogo}
            alt="Everybody Counts"
            className="h-16 w-auto object-contain mx-auto mb-4"
          />
          <p className={`leading-relaxed transition-colors duration-500 ${
            isDarkMode ? 'text-slate-300' : 'text-slate-600'
          }`}>
            Your KS1 maths teaching assistant. Ask questions about lesson plans,
            activities, and teaching strategies for Year 1 and Year 2.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col h-full transition-colors duration-500 ${
      isDarkMode
        ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900'
        : 'bg-gradient-to-br from-slate-50 via-white to-slate-50'
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between p-4 border-b transition-all duration-500 ${
        isDarkMode
          ? 'bg-slate-800/80 backdrop-blur-sm border-slate-700/50 shadow-sm'
          : 'bg-white/80 backdrop-blur-sm border-slate-200/50 shadow-sm'
      }`}>
        <div className="flex items-center">
          <button
            onClick={onToggleSidebar}
            className={`lg:hidden p-2 rounded-lg transition-all duration-300 mr-3 ${
              isDarkMode
                ? 'hover:bg-slate-700 text-slate-300'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <h2 className={`text-lg font-semibold transition-colors duration-500 ${
              isDarkMode ? 'text-slate-100' : 'text-slate-900'
            }`}>
              {session.title}
            </h2>
            <p className={`text-sm transition-colors duration-500 ${
              isDarkMode ? 'text-slate-400' : 'text-slate-500'
            }`}>
              {session.messages.length} messages
            </p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-6 relative">
        {session.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md animate-fade-in">
              <h3 className={`text-xl font-semibold mb-4 transition-colors duration-500 ${
                isDarkMode ? 'text-slate-100' : 'text-slate-700'
              }`}>
                How can I help you today?
              </h3>
              <div className="space-y-3">
                {[
                  "Give me some assessment questions for a Year 1 class across the curriculum",
                  "I have just taught counting and comparing numbers to 20 in Year 1 — based on the current lesson sequence, what is the next lesson I should teach?",
                  "I have just taught addition and subtraction facts within 10 in Year 1 — based on the current lesson sequence, what is the next lesson I should teach?",
                  "I have just taught place value (tens and ones) in Year 2 — based on the current lesson sequence, what is the next lesson I should teach?",
                  "How do I introduce counting within 100 to my Year 1 class?",
                  "What manipulatives are recommended for teaching number bonds to 10 in Year 1?",
                  "How can I use part-whole models to teach addition in Year 1?",
                  "How do the Year 2 materials approach teaching fractions for the first time?",
                ].map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setInputMessage(suggestion);
                      setTimeout(() => handleSendMessage(), 100);
                    }}
                    className={`w-full px-4 py-3 rounded-xl text-sm text-left transition-all duration-300 hover:scale-105 ${
                      isDarkMode
                        ? 'bg-slate-700/30 hover:bg-slate-700/50 text-slate-300'
                        : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                    }`}
                  >
                    "{suggestion}"
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          session.messages.map((message, index) => (
            <div key={message.id} className="animate-fade-in" style={{ animationDelay: `${index * 0.1}s` }}>
              <MessageBubble message={message} />
            </div>
          ))
        )}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex justify-start animate-fade-in">
            <div className={`chat-bubble transition-all duration-500 ${
              isDarkMode
                ? 'bg-slate-800/80 backdrop-blur-sm border border-slate-700/50'
                : 'bg-white/80 backdrop-blur-sm border border-slate-200/50'
            }`}>
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  {[0, 0.1, 0.2].map((delay, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full animate-bounce ${
                        isDarkMode ? 'bg-slate-400' : 'bg-slate-400'
                      }`}
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
                <span className={`text-sm transition-colors duration-500 ${
                  isDarkMode ? 'text-slate-300' : 'text-slate-600'
                }`}>
                  {progressMessage || 'Thinking...'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className={`fixed bottom-32 right-6 p-3 rounded-full shadow-lg border transition-all duration-300 hover:scale-110 z-10 ${
              isDarkMode
                ? 'bg-slate-700/90 hover:bg-slate-600 border-slate-600 text-slate-300'
                : 'bg-white/90 hover:bg-gray-50 border-gray-200 text-gray-600'
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Follow-up Suggestions */}
      {suggestedQuestions.length > 0 && !isLoading && (
        <div className={`px-4 py-3 border-t transition-all duration-500 ${
          isDarkMode
            ? 'bg-slate-800/50 backdrop-blur-sm border-slate-700/50'
            : 'bg-gray-50/80 backdrop-blur-sm border-slate-200/50'
        }`}>
          <div className="max-w-4xl mx-auto">
            <p className={`text-xs font-medium mb-2 ${
              isDarkMode ? 'text-slate-400' : 'text-slate-500'
            }`}>
              Suggested follow-ups:
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((question, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setInputMessage(question);
                    setSuggestedQuestions([]);
                    setTimeout(() => handleSendMessage(), 100);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all duration-200 hover:scale-105 ${
                    isDarkMode
                      ? 'bg-slate-700/70 hover:bg-slate-700 text-slate-200 border border-slate-600/50'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
                  }`}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className={`p-4 border-t transition-all duration-500 ${
        isDarkMode
          ? 'bg-slate-800/80 backdrop-blur-sm border-slate-700/50'
          : 'bg-white/80 backdrop-blur-sm border-slate-200/50'
      }`}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end space-x-3">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isLoading ? "Thinking..." : "Ask about KS1 maths teaching..."}
                className={`w-full px-4 py-3 border rounded-2xl resize-none transition-all duration-300 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 min-h-[44px] max-h-32 ${
                  isDarkMode
                    ? 'bg-slate-700/80 backdrop-blur-sm border-slate-600 text-slate-100 placeholder-slate-400 focus:bg-slate-700/90'
                    : 'bg-white/90 backdrop-blur-sm border-slate-300 text-slate-900 placeholder-slate-500 focus:bg-white'
                }`}
                rows={1}
                disabled={isLoading}
              />
            </div>

            <button
              onClick={() => handleSendMessage()}
              disabled={!inputMessage.trim() || isLoading}
              className={`px-6 py-3 rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl min-w-[80px] justify-center flex items-center space-x-2 ${
                isDarkMode
                  ? 'bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white'
                  : 'bg-gradient-to-r from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700 text-white'
              }`}
            >
              {isLoading ? (
                <>
                  <StopCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">Stop</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Send</span>
                </>
              )}
            </button>
          </div>

          <div className={`mt-2 text-xs flex items-center justify-between transition-colors duration-500 ${
            isDarkMode ? 'text-slate-400' : 'text-slate-500'
          }`}>
            <span>Press Enter to send, Shift+Enter for new line</span>
            <span className={isDarkMode ? 'text-slate-500' : 'text-slate-400'}>
              {inputMessage.length}/4000
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
