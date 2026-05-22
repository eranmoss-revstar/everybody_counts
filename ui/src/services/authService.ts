/**
 * Auth service selector.
 *
 * Reads REACT_APP_AUTH_MODE at module load and exports either the real
 * Cognito implementation or the in-memory mock. Components and the
 * AuthContext import from here so they never touch the underlying
 * SDK directly and never branch on the env var themselves.
 */
import { CognitoAuthService } from './cognito';
import { MockCognitoAuthService } from './mockCognito';

const IS_COGNITO = process.env.REACT_APP_AUTH_MODE === 'cognito';

const AuthService = IS_COGNITO ? CognitoAuthService : MockCognitoAuthService;

export default AuthService;
export type { AuthResult } from './cognito';
