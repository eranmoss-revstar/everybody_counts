/**
 * Mock Cognito Auth Service
 *
 * Mirrors the static API of CognitoAuthService so they can be swapped at the
 * selector level (see services/authService.ts). Every flow completes against
 * in-memory state + localStorage:
 *
 *   - signIn accepts testuser / demo123 (or any email + "demo123")
 *   - signUp / confirmSignUp / forgotPassword / confirmPassword / resendCode
 *     all resolve successfully after a short artificial delay so the UI
 *     can be demoed end-to-end without a backend
 *   - getIdTokenClaims returns a fake JWT-shaped claim bag
 */
import { AuthResult } from './cognito';

const MOCK_TOKEN_PREFIX = 'mock-jwt-token-';
const DEMO_PASSWORD = 'demo123';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildMockToken(email: string): string {
  // Produce a token shape that getIdTokenClaims can decode like a real JWT.
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: `mock-${email}`,
      email,
      name: email.split('@')[0],
      'custom:tenant_id': 'demo-tenant',
      'cognito:groups': email.startsWith('admin') ? 'admin' : 'viewer',
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  return `${MOCK_TOKEN_PREFIX}${header}.${payload}.mock-signature`;
}

export class MockCognitoAuthService {
  static async signIn(username: string, password: string): Promise<AuthResult> {
    await delay(400);
    const looksLikeEmail = username.includes('@');
    const demoUser = username === 'testuser' && password === DEMO_PASSWORD;
    const validEmailLogin = looksLikeEmail && password === DEMO_PASSWORD;

    if (!demoUser && !validEmailLogin) {
      return {
        success: false,
        error: 'Invalid credentials. Try testuser / demo123 or any email / demo123.',
      };
    }

    const email = looksLikeEmail ? username : 'testuser@example.com';
    const idToken = buildMockToken(email);

    localStorage.setItem('auth_token', idToken);
    localStorage.setItem('access_token', idToken);
    localStorage.setItem('refresh_token', `${MOCK_TOKEN_PREFIX}refresh`);
    localStorage.setItem('user_id', email);

    return {
      success: true,
      message: 'Authentication successful',
      idToken,
      accessToken: idToken,
      refreshToken: `${MOCK_TOKEN_PREFIX}refresh`,
    };
  }

  static signOut(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('session_id');
    localStorage.removeItem('user_role');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('user_display_name');
  }

  static getCurrentUser(): { username: string } | null {
    const username = localStorage.getItem('user_id');
    return username ? { username } : null;
  }

  static async isAuthenticated(): Promise<boolean> {
    return !!localStorage.getItem('auth_token');
  }

  static async getSession(): Promise<{ isValid: () => boolean } | null> {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    return { isValid: () => true };
  }

  static async signUp(
    email: string,
    _password: string,
    _attributes: Record<string, string> = {},
  ): Promise<AuthResult> {
    await delay(500);
    if (!email.includes('@')) {
      return { success: false, error: 'Please enter a valid email.' };
    }
    return {
      success: true,
      message: 'Verification code sent to your email (demo: any 6-digit code works)',
    };
  }

  static async confirmSignUp(_email: string, code: string): Promise<AuthResult> {
    await delay(300);
    if (!/^\d{6}$/.test(code)) {
      return { success: false, error: 'Code must be 6 digits.' };
    }
    return { success: true, message: 'Email verified successfully' };
  }

  static async resendConfirmationCode(_email: string): Promise<AuthResult> {
    await delay(300);
    return { success: true, message: 'Verification code resent (demo: any 6-digit code works)' };
  }

  static async forgotPassword(email: string): Promise<AuthResult> {
    await delay(300);
    if (!email.includes('@')) {
      return { success: false, error: 'Please enter a valid email.' };
    }
    return { success: true, message: 'Reset code sent to your email (demo: any 6-digit code works)' };
  }

  static async confirmPassword(
    _email: string,
    code: string,
    newPassword: string,
  ): Promise<AuthResult> {
    await delay(400);
    if (!/^\d{6}$/.test(code)) {
      return { success: false, error: 'Code must be 6 digits.' };
    }
    if (newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' };
    }
    return { success: true, message: 'Password reset successfully' };
  }

  static getIdTokenClaims(): Record<string, string> | null {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch {
      return null;
    }
  }

  static async refreshSession(): Promise<boolean> {
    return !!localStorage.getItem('auth_token');
  }
}

export default MockCognitoAuthService;
