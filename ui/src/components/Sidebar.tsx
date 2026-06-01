import React, { useState, useEffect } from 'react';
import {
  Plus,
  MessageSquare,
  Trash2,
  Menu,
  X,
  Clock,
  Settings,
  Search,
  User,
  Palette,
  LogOut,
  SlidersHorizontal,
} from 'lucide-react';
import { SidebarProps } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { getAdminSettings, updateAdminSettings } from '../services/api';

const LENGTH_OPTIONS = [
  { label: 'Brief', value: 400 },
  { label: 'Standard', value: 1000 },
  { label: 'Detailed', value: 2000 },
];

const TONE_OPTIONS = [
  { label: 'Precise', value: 0.2 },
  { label: 'Balanced', value: 0.7 },
  { label: 'Creative', value: 0.9 },
];


const EXAMPLE_PROMPTS = [
  "What does the Teacher Notes say about teaching tens and ones in Year 2?",
  "What activities are suggested for teaching number bonds to 10 in Year 1?",
  "What does the Maths Mastery training say about the concrete-pictorial-abstract approach?",
  "How do I teach fractions to Year 5 pupils?",
  "What are the best KS1 science activities for Year 1?",
];

const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSession,
  onSessionSelect,
  onCreateSession,
  onDeleteSession,
  onStartWithPrompt,
  isOpen,
  onToggle,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [savingLLM, setSavingLLM] = useState(false);
  const { isDarkMode } = useTheme();
  const { logout, user, getIdToken } = useAuth();

  const isAdmin = user?.groups?.includes('admins') ?? false;

  useEffect(() => {
    if (!isAdmin) return;
    const token = getIdToken();
    if (!token) return;
    getAdminSettings(token)
      .then(s => { setTemperature(s.temperature); setMaxTokens(s.maxTokens); })
      .catch(() => {});
  }, [isAdmin, getIdToken]);

  const saveLLMSettings = async (temp: number, tokens: number) => {
    const token = getIdToken();
    if (!token) return;
    setSavingLLM(true);
    try {
      await updateAdminSettings(token, { temperature: temp, maxTokens: tokens });
    } finally {
      setSavingLLM(false);
    }
  };

  const displayName = user?.name || user?.email || 'User';
  const displayEmail = user?.email || '';

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString();
    }
  };

  const truncateTitle = (title: string, maxLength: number = 30): string => {
    return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
  };

  const filteredSessions = sessions.filter(session =>
    session.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden backdrop-blur-sm"
          onClick={onToggle}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`w-full max-w-md my-8 rounded-2xl shadow-2xl transition-all duration-300 ${
            isDarkMode
              ? 'bg-gray-800 border border-gray-700'
              : 'bg-white border border-gray-200'
          }`}>
            {/* Modal Header */}
            <div className={`flex items-center justify-between p-6 border-b ${
              isDarkMode ? 'border-gray-700' : 'border-gray-200'
            }`}>
              <h3 className={`text-lg font-semibold transition-colors duration-300 ${
                isDarkMode ? 'text-gray-100' : 'text-gray-900'
              }`}>
                Settings
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  isDarkMode
                    ? 'hover:bg-gray-700 text-gray-300'
                    : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* User Profile */}
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className={`font-medium truncate transition-colors duration-300 ${
                      isDarkMode ? 'text-gray-100' : 'text-gray-900'
                    }`}>
                      {displayName}
                    </p>
                    <p className={`text-sm truncate transition-colors duration-300 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      {displayEmail}
                    </p>
                  </div>
                </div>
              </div>

              {/* Theme */}
              <div className={`p-4 rounded-xl border transition-all duration-300 ${
                isDarkMode
                  ? 'bg-gray-700/50 border-gray-600'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center space-x-3">
                  <Palette className={`w-5 h-5 ${
                    isDarkMode ? 'text-purple-400' : 'text-purple-600'
                  }`} />
                  <div className="flex-1">
                    <p className={`font-medium transition-colors duration-300 ${
                      isDarkMode ? 'text-gray-100' : 'text-gray-900'
                    }`}>
                      Theme
                    </p>
                    <p className={`text-sm transition-colors duration-300 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      {isDarkMode ? 'Dark Mode' : 'Light Mode'}
                    </p>
                  </div>
                </div>
              </div>

              {/* LLM Behaviour — admin only */}
              {isAdmin && (
                <div className={`p-4 rounded-xl border transition-all duration-300 ${
                  isDarkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-center space-x-3 mb-3">
                    <SlidersHorizontal className={`w-5 h-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <p className={`font-medium transition-colors duration-300 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                      LLM Behaviour
                    </p>
                    {savingLLM && (
                      <span className={`text-xs ml-auto ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Saving…</span>
                    )}
                  </div>
                  <p className={`text-xs mb-1.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Response Length</p>
                  <div className="flex gap-1 mb-3">
                    {LENGTH_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setMaxTokens(opt.value); saveLLMSettings(temperature, opt.value); }}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                          maxTokens === opt.value
                            ? 'bg-blue-500 text-white font-medium'
                            : isDarkMode ? 'bg-gray-600 text-gray-300 hover:bg-gray-500' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className={`text-xs mb-1.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Tone</p>
                  <div className="flex gap-1">
                    {TONE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setTemperature(opt.value); saveLLMSettings(opt.value, maxTokens); }}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                          temperature === opt.value
                            ? 'bg-blue-500 text-white font-medium'
                            : isDarkMode ? 'bg-gray-600 text-gray-300 hover:bg-gray-500' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Logout Button */}
              <div>
                <button
                  onClick={async () => {
                    try {
                      await logout();
                    } catch (error) {
                      console.error('Logout failed:', error);
                    }
                  }}
                  className={`w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl font-medium transition-all duration-300 ${
                    isDarkMode
                      ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30'
                      : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
                  }`}
                >
                  <LogOut className="w-5 h-5" />
                  <span>Logout</span>
                </button>
              </div>

              {/* Version Info */}
              <div className={`text-center pt-4 border-t ${
                isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
                <p className={`text-xs transition-colors duration-300 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  Everybody Counts v1.0.0
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 w-80 border-r transform transition-all duration-300 ease-in-out shadow-xl lg:shadow-none
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
        ${isDarkMode 
          ? 'bg-gray-900/95 backdrop-blur-md border-gray-700/50' 
          : 'bg-white/95 backdrop-blur-md border-gray-200/50'
        }
      `}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b transition-all duration-300 ${
          isDarkMode ? 'border-slate-700/50' : 'border-slate-200/50'
        }`}>
          <div className="flex items-center space-x-2">
            <h1 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
              Everybody Counts
            </h1>
          </div>
          <button
            onClick={onToggle}
            className={`lg:hidden p-2 rounded-lg transition-all duration-200 ${
              isDarkMode
                ? 'hover:bg-slate-700 text-slate-300'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>


        {/* Search */}
        <div className={`p-4 border-b transition-all duration-300 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-200/50'
        }`}>
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ${
              isDarkMode ? 'text-gray-400' : 'text-gray-400'
            }`} />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all duration-200 ${
                isDarkMode
                  ? 'bg-gray-800/80 border-gray-600 text-gray-100 placeholder-gray-400'
                  : 'bg-white/80 border-gray-200 text-gray-900 placeholder-gray-500'
              }`}
            />
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <button
            onClick={onCreateSession}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Example Prompts */}
        <div className={`px-4 pb-3 border-b transition-all duration-300 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-200/50'
        }`}>
          <p className={`text-xs font-medium mb-2 ${
            isDarkMode ? 'text-gray-500' : 'text-gray-400'
          }`}>Try asking:</p>
          <div className="space-y-1">
            {EXAMPLE_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => onStartWithPrompt(prompt)}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-all duration-200 truncate ${
                  isDarkMode
                    ? 'text-gray-300 hover:bg-gray-800/60 hover:text-white'
                    : 'text-gray-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                title={prompt}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-6 text-center animate-fade-in">
              <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center transition-all duration-300 ${
                isDarkMode
                  ? 'bg-gradient-to-r from-gray-700 to-gray-800'
                  : 'bg-gradient-to-r from-gray-100 to-gray-200'
              }`}>
                <MessageSquare className={`w-8 h-8 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-400'
                }`} />
              </div>
              <p className={`font-medium mb-2 transition-colors duration-300 ${
                isDarkMode ? 'text-gray-300' : 'text-gray-500'
              }`}>
                No conversations yet
              </p>
              <p className={`text-sm transition-colors duration-300 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Start a new chat to begin
              </p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-6 text-center">
              <p className={`text-sm transition-colors duration-300 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                No conversations match your search
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredSessions.map((session, index) => (
                <div
                  key={session.id}
                  className={`
                    sidebar-item group relative rounded-xl transition-all duration-200 cursor-pointer
                    ${currentSession?.id === session.id 
                      ? isDarkMode
                        ? 'bg-gradient-to-r from-slate-700/50 to-slate-800/50 text-slate-300 border border-slate-600/50 shadow-sm'
                        : 'bg-gradient-to-r from-slate-100/50 to-slate-200/50 text-slate-700 border border-slate-300/50 shadow-sm'
                      : isDarkMode
                        ? 'hover:bg-gray-800/50 text-gray-300'
                        : 'hover:bg-gray-50 text-gray-700'
                    }
                  `}
                  onClick={() => onSessionSelect(session)}
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <MessageSquare className={`w-4 h-4 mr-3 flex-shrink-0 transition-colors duration-300 ${
                    currentSession?.id === session.id 
                      ? 'text-slate-400' 
                      : isDarkMode ? 'text-gray-400' : 'text-gray-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate transition-colors duration-300 ${
                      currentSession?.id === session.id 
                        ? isDarkMode ? 'text-slate-300' : 'text-slate-700'
                        : isDarkMode ? 'text-gray-200' : 'text-gray-700'
                    }`}>
                      {truncateTitle(session.title)}
                    </p>
                    <div className={`flex items-center text-xs mt-1 transition-colors duration-300 ${
                      isDarkMode ? 'text-gray-500' : 'text-gray-500'
                    }`}>
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDate(session.updatedAt)}
                      <span className="mx-2">•</span>
                      <span>{session.messages.length} messages</span>
                    </div>
                  </div>
                  
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className={`opacity-0 group-hover:opacity-100 p-2 rounded-lg transition-all duration-200 ${
                      isDarkMode
                        ? 'hover:bg-red-900/30 hover:text-red-400'
                        : 'hover:bg-red-100 hover:text-red-600'
                    }`}
                    title="Delete conversation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-4 border-t transition-all duration-300 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-200/50'
        }`}>
          <button 
            onClick={() => setShowSettings(true)}
            className={`sidebar-item w-full rounded-xl transition-all duration-300 ${
              isDarkMode
                ? 'text-gray-300 hover:bg-gray-800/50'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Settings className="w-4 h-4 mr-3" />
            Settings
          </button>
        </div>
      </div>

      {/* Mobile toggle button */}
      <button
        onClick={onToggle}
        className={`lg:hidden fixed top-4 left-4 z-30 p-3 rounded-xl shadow-lg border transition-all duration-200 hover:scale-105 ${
          isDarkMode
            ? 'bg-gray-800/90 backdrop-blur-sm border-gray-600/50 hover:bg-gray-700'
            : 'bg-white/90 backdrop-blur-sm border-gray-200/50 hover:bg-white'
        }`}
      >
        <Menu className="w-5 h-5" />
      </button>
    </>
  );
};

export default Sidebar; 