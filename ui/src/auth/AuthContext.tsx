import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { AuthMode, AuthUser } from '../types';
import AuthService, { AuthResult } from '../services/authService';
import CognitoAuthService from '../services/cognito';

const AUTH_MODE: AuthMode =
  process.env.REACT_APP_AUTH_MODE === 'cognito' ? 'cognito' : 'mock';

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authMode: AuthMode;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  getIdToken: () => string | null;
  signUp: (
    email: string,
    password: string,
    attrs: Record<string, string>,
  ) => Promise<AuthResult>;
  confirmSignUp: (email: string, code: string) => Promise<AuthResult>;
  forgotPassword: (email: string) => Promise<AuthResult>;
  confirmPassword: (
    email: string,
    code: string,
    newPwd: string,
  ) => Promise<AuthResult>;
  resendCode: (email: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function userFromClaims(
  claims: Record<string, string>,
  emailFallback = '',
): AuthUser {
  const email = claims.email || emailFallback;
  const groupsRaw = claims['cognito:groups'];
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw.filter(Boolean)
    : (groupsRaw ? String(groupsRaw).split(',') : ['viewer']).filter(Boolean);
  return {
    email,
    userId: claims.sub || '',
    tenantId: claims['custom:tenant_id'] || '',
    role: groups[0] || 'viewer',
    name: claims.name || email.split('@')[0] || '',
    groups,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);

  const checkAuthState = useCallback(async () => {
    try {
      const session = await CognitoAuthService.getSession();
      if (session && session.isValid()) {
        const freshToken = session.getIdToken().getJwtToken();
        localStorage.setItem('auth_token', freshToken);
        const claims = JSON.parse(atob(freshToken.split('.')[1]));
        setUser(userFromClaims(claims));
        setIdToken(freshToken);
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuthState();
  }, [checkAuthState]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const result = await AuthService.signIn(email, password);
      if (!result.success) throw new Error(result.error);

      const claims = AuthService.getIdTokenClaims();
      setUser(userFromClaims(claims || {}, email));
      setIdToken(result.idToken || localStorage.getItem('auth_token'));
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      AuthService.signOut();
      setUser(null);
      setIdToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshToken = async () => {
    await AuthService.refreshSession();
    await checkAuthState();
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    authMode: AUTH_MODE,
    login,
    logout,
    refreshToken,
    getIdToken: () => idToken,
    signUp: (email, password, attrs) =>
      AuthService.signUp(email, password, attrs),
    confirmSignUp: (email, code) => AuthService.confirmSignUp(email, code),
    forgotPassword: (email) => AuthService.forgotPassword(email),
    confirmPassword: (email, code, newPwd) =>
      AuthService.confirmPassword(email, code, newPwd),
    resendCode: (email) => AuthService.resendConfirmationCode(email),
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
