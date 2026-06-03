export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
  isError?: boolean;
  metadata?: {
    sql_query?: string;
    source?: string;
    confidence?: number;
    follow_up_suggestions?: string[];
    raw_data?: any[];
    sources?: string[];
    sourceLinks?: { name: string; url: string }[];
  };
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatInterfaceProps {
  session: Session | null;
  onUpdateSession: (sessionId: string, updates: Partial<Session>) => void;
  onToggleSidebar: () => void;
  pendingMessage?: string;
  onClearPendingMessage?: () => void;
}

export interface SidebarProps {
  sessions: Session[];
  currentSession: Session | null;
  onSessionSelect: (session: Session) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onStartWithPrompt: (message: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export interface MessageBubbleProps {
  message: Message;
}

export interface ThemeContextType {
  isDarkMode: boolean;
  toggleTheme: () => void;
}

// Auth types
export type AuthMode = 'mock' | 'cognito';

export interface AuthUser {
  email: string;
  userId: string;
  tenantId: string;
  role: string;
  name?: string;
  groups?: string[];
}

export type AuthScreen = 'login' | 'register' | 'verify' | 'forgotPassword';
