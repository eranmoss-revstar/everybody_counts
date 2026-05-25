import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import AuthRouter from './components/auth/AuthRouter';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { Session } from './types';

const TIMEOUT_TOAST_MS = 5000;

const AppContent: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [timeoutToast, setTimeoutToast] = useState<string>('');
  const { isAuthenticated, isLoading, logout, user } = useAuth();
  const { isDarkMode, toggleTheme } = useTheme();

  const sessionsKey = user ? `chat-sessions-${user.email}` : null;

  // Load sessions from localStorage when the user is resolved
  useEffect(() => {
    if (!sessionsKey) return;
    try {
      const saved = localStorage.getItem(sessionsKey);
      if (saved) {
        const parsed: Session[] = JSON.parse(saved);
        setSessions(parsed);
        if (parsed.length > 0) setCurrentSession(parsed[0]);
      }
    } catch {
      // ignore parse errors
    }
  }, [sessionsKey]);

  // Persist sessions per user whenever they change
  useEffect(() => {
    if (isAuthenticated && sessionsKey) {
      localStorage.setItem(sessionsKey, JSON.stringify(sessions));
    }
  }, [sessions, isAuthenticated, sessionsKey]);

  // React to passive session-timeout events from utils/sessionManager.
  // Replaces the previous blocking window.confirm with an auto-logout
  // and a dismissible toast. Chat state is cleared by the effect below
  // in response to isAuthenticated flipping false — no need to do it here.
  //
  // Guard: sessionManager initializes on module load (before auth), so a
  // user idling on the login screen for 30 min would otherwise see a
  // phantom "Session expired" toast. Lingering timers after logout get
  // the same treatment.
  useEffect(() => {
    const handler = () => {
      if (!isAuthenticated) return;
      logout();
      setTimeoutToast('Session expired. Please log in again.');
    };
    window.addEventListener('session:timeout', handler);
    return () => window.removeEventListener('session:timeout', handler);
  }, [logout, isAuthenticated]);

  // Clear in-memory sessions when the user logs out so the previous
  // user's chats don't show briefly before the login screen appears.
  // History is preserved in localStorage keyed by email.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setSessions([]);
      setCurrentSession(null);
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (!timeoutToast) return;
    const t = setTimeout(() => setTimeoutToast(''), TIMEOUT_TOAST_MS);
    return () => clearTimeout(t);
  }, [timeoutToast]);

  const createNewSession = (): void => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: `New Chat ${sessions.length + 1}`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setSessions([newSession, ...sessions]);
    setCurrentSession(newSession);
  };

  const updateSession = (sessionId: string, updates: Partial<Session>): void => {
    setSessions(prevSessions =>
      prevSessions.map(session =>
        session.id === sessionId
          ? { ...session, ...updates, updatedAt: new Date().toISOString() }
          : session
      )
    );
    if (currentSession?.id === sessionId) {
      setCurrentSession(prev => prev ? { ...prev, ...updates, updatedAt: new Date().toISOString() } : null);
    }
  };

  const deleteSession = (sessionId: string): void => {
    setSessions(prevSessions => prevSessions.filter(session => session.id !== sessionId));
    if (currentSession?.id === sessionId) {
      const remainingSessions = sessions.filter(session => session.id !== sessionId);
      setCurrentSession(remainingSessions.length > 0 ? remainingSessions[0] : null);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex h-screen items-center justify-center ${
        isDarkMode
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900'
          : 'bg-gradient-to-br from-slate-50 via-white to-slate-50'
      }`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Show auth screens if not authenticated
  if (!isAuthenticated) {
    return (
      <div className={`flex h-screen font-sans transition-colors duration-500 ${
        isDarkMode
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100'
          : 'bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900'
      }`}>
        <div className="flex-1 flex items-center justify-center p-4">
          <AuthRouter />
        </div>
        {timeoutToast && <Toast message={timeoutToast} onDismiss={() => setTimeoutToast('')} isDarkMode={isDarkMode} />}
      </div>
    );
  }

  return (
    <div className={`flex h-screen font-sans transition-colors duration-500 ${
      isDarkMode
        ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100'
        : 'bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900'
    }`}>
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        currentSession={currentSession}
        onSessionSelect={setCurrentSession}
        onCreateSession={createNewSession}
        onDeleteSession={deleteSession}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main Chat Interface */}
      <div className="flex-1 flex flex-col">
        <ChatInterface
          session={currentSession}
          onUpdateSession={updateSession}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>

      {/* Theme Toggle Button */}
      <button
        onClick={toggleTheme}
        className={`fixed top-6 right-6 z-50 p-4 rounded-full transition-all duration-500 shadow-xl hover:shadow-2xl hover:scale-110 backdrop-blur-xl ${
          isDarkMode
            ? 'bg-slate-800/80 text-yellow-400 hover:bg-slate-700/90 border border-slate-700/50'
            : 'bg-white/80 text-slate-600 hover:bg-white/90 border border-slate-200/50'
        }`}
        aria-label="Toggle theme"
      >
        {isDarkMode ? (
          <div className="w-6 h-6 flex items-center justify-center">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          </div>
        ) : (
          <div className="w-6 h-6 flex items-center justify-center">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          </div>
        )}
      </button>

      {timeoutToast && <Toast message={timeoutToast} onDismiss={() => setTimeoutToast('')} isDarkMode={isDarkMode} />}
    </div>
  );
};

interface ToastProps {
  message: string;
  onDismiss: () => void;
  isDarkMode: boolean;
}

const Toast: React.FC<ToastProps> = ({ message, onDismiss, isDarkMode }) => (
  <div
    role="status"
    className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border backdrop-blur-xl animate-fade-in ${
      isDarkMode
        ? 'bg-slate-800/95 border-slate-700/50 text-slate-100'
        : 'bg-white/95 border-slate-200/50 text-slate-800'
    }`}
  >
    <span className="text-sm">{message}</span>
    <button
      onClick={onDismiss}
      aria-label="Dismiss"
      className={`text-xs font-medium transition-colors duration-200 ${
        isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      Dismiss
    </button>
  </div>
);

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
