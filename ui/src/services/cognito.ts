/**
 * AWS Cognito Authentication Service
 * Handles user authentication with AWS Cognito User Pool
 */

import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

// Cognito configuration from CDK deployment outputs.
// This module is imported unconditionally by authService.ts, so the pool must
// instantiate cleanly even in mock mode — where these env vars are empty.
const USER_POOL_ID = process.env.REACT_APP_USER_POOL_ID;
const USER_POOL_CLIENT_ID = process.env.REACT_APP_USER_POOL_CLIENT_ID;

if (
  process.env.REACT_APP_AUTH_MODE === 'cognito' &&
  (!USER_POOL_ID || !USER_POOL_CLIENT_ID)
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] REACT_APP_AUTH_MODE=cognito but REACT_APP_USER_POOL_ID and/or ' +
      'REACT_APP_USER_POOL_CLIENT_ID are not set. Populate them from your ' +
      'CDK stack outputs (see Lambdas.md) or set REACT_APP_AUTH_MODE=mock ' +
      'to use the demo instead.',
  );
}

// Fallback values follow Cognito's format rules so the SDK instantiates
// cleanly even when unconfigured. Any real network call in cognito mode
// will still fail — by design — with a clear Cognito error.
const poolData = {
  UserPoolId: USER_POOL_ID || 'us-east-1_UNCONFIG',
  ClientId: USER_POOL_CLIENT_ID || 'UNCONFIGUREDCLIENTID00000',
};

const userPool = new CognitoUserPool(poolData);

export interface AuthResult {
  success: boolean;
  message?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

export class CognitoAuthService {
  /**
   * Sign in a user with username and password
   */
  static async signIn(username: string, password: string): Promise<AuthResult> {
    return new Promise((resolve) => {
      const userData = {
        Username: username,
        Pool: userPool,
      };

      const cognitoUser = new CognitoUser(userData);
      
      const authenticationDetails = new AuthenticationDetails({
        Username: username,
        Password: password,
      });

      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (session: CognitoUserSession) => {
          // Store tokens in localStorage
          const idToken = session.getIdToken().getJwtToken();
          const accessToken = session.getAccessToken().getJwtToken();
          const refreshToken = session.getRefreshToken().getToken();

          localStorage.setItem('auth_token', idToken);
          localStorage.setItem('access_token', accessToken);
          localStorage.setItem('refresh_token', refreshToken);
          localStorage.setItem('user_id', username);

          resolve({
            success: true,
            message: 'Authentication successful',
            idToken,
            accessToken,
            refreshToken,
          });
        },
        onFailure: (err) => {
          console.error('Authentication failed:', err);
          resolve({
            success: false,
            error: err.message || 'Authentication failed',
          });
        },
        newPasswordRequired: (userAttributes, requiredAttributes) => {
          // Handle new password requirement
          console.log('New password required');
          resolve({
            success: false,
            error: 'New password required. Please contact administrator.',
          });
        },
      });
    });
  }

  /**
   * Sign out the current user
   */
  static signOut(): void {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    
    // Clear all stored tokens and user data
    localStorage.removeItem('auth_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('session_id');
    localStorage.removeItem('user_role');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('user_display_name');
  }

  /**
   * Get the current authenticated user
   */
  static getCurrentUser(): CognitoUser | null {
    return userPool.getCurrentUser();
  }

  /**
   * Check if a user is currently authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    return new Promise((resolve) => {
      const cognitoUser = userPool.getCurrentUser();
      
      if (!cognitoUser) {
        resolve(false);
        return;
      }

      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          resolve(false);
          return;
        }

        resolve(session.isValid());
      });
    });
  }

  /**
   * Get the current session
   */
  static async getSession(): Promise<CognitoUserSession | null> {
    return new Promise((resolve) => {
      const cognitoUser = userPool.getCurrentUser();
      
      if (!cognitoUser) {
        resolve(null);
        return;
      }

      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          resolve(null);
          return;
        }

        resolve(session);
      });
    });
  }

  /**
   * Sign up a new user
   */
  static async signUp(
    email: string,
    password: string,
    attributes: Record<string, string> = {}
  ): Promise<AuthResult> {
    return new Promise((resolve) => {
      const attributeList = Object.entries(attributes)
        .filter(([_, v]) => v)
        .map(([k, v]) => new CognitoUserAttribute({ Name: k, Value: v }));

      // Always include email
      attributeList.push(new CognitoUserAttribute({ Name: 'email', Value: email }));

      userPool.signUp(email, password, attributeList, [], (err, result) => {
        if (err) {
          resolve({ success: false, error: err.message || 'Sign up failed' });
          return;
        }
        resolve({
          success: true,
          message: 'Verification code sent to your email',
        });
      });
    });
  }

  /**
   * Confirm sign up with verification code
   */
  static async confirmSignUp(email: string, code: string): Promise<AuthResult> {
    return new Promise((resolve) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      cognitoUser.confirmRegistration(code, true, (err, result) => {
        if (err) {
          resolve({ success: false, error: err.message || 'Verification failed' });
          return;
        }
        resolve({ success: true, message: 'Email verified successfully' });
      });
    });
  }

  /**
   * Resend confirmation code
   */
  static async resendConfirmationCode(email: string): Promise<AuthResult> {
    return new Promise((resolve) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      cognitoUser.resendConfirmationCode((err) => {
        if (err) {
          resolve({ success: false, error: err.message || 'Failed to resend code' });
        } else {
          resolve({ success: true, message: 'Verification code resent' });
        }
      });
    });
  }

  /**
   * Initiate forgot password flow
   */
  static async forgotPassword(email: string): Promise<AuthResult> {
    return new Promise((resolve) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      cognitoUser.forgotPassword({
        onSuccess: () => {
          resolve({ success: true, message: 'Reset code sent to your email' });
        },
        onFailure: (err) => {
          resolve({ success: false, error: err.message || 'Failed to send reset code' });
        },
      });
    });
  }

  /**
   * Confirm new password with reset code
   */
  static async confirmPassword(
    email: string,
    code: string,
    newPassword: string
  ): Promise<AuthResult> {
    return new Promise((resolve) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => {
          resolve({ success: true, message: 'Password reset successfully' });
        },
        onFailure: (err) => {
          resolve({ success: false, error: err.message || 'Password reset failed' });
        },
      });
    });
  }

  /**
   * Parse claims from the stored ID token
   */
  static getIdTokenClaims(): Record<string, string> | null {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch {
      return null;
    }
  }

  /**
   * Refresh the current session tokens
   */
  static async refreshSession(): Promise<boolean> {
    const session = await this.getSession();
    
    if (!session) {
      return false;
    }

    return new Promise((resolve) => {
      const cognitoUser = userPool.getCurrentUser();
      
      if (!cognitoUser) {
        resolve(false);
        return;
      }

      const refreshToken = session.getRefreshToken();
      
      cognitoUser.refreshSession(refreshToken, (err, newSession) => {
        if (err) {
          console.error('Failed to refresh session:', err);
          resolve(false);
          return;
        }

        // Update stored tokens
        const idToken = newSession.getIdToken().getJwtToken();
        const accessToken = newSession.getAccessToken().getJwtToken();
        
        localStorage.setItem('auth_token', idToken);
        localStorage.setItem('access_token', accessToken);
        
        resolve(true);
      });
    });
  }
}

export default CognitoAuthService;