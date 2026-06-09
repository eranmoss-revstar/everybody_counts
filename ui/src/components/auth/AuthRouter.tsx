import React, { useState } from 'react';
import LoginForm from './LoginForm';
import ForgotPassword from './ForgotPassword';
import { useAuth } from '../../auth/AuthContext';

type Screen = 'login' | 'forgotPassword';

const AuthRouter: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('login');
  const { needsPasswordReset, resetEmail, clearPasswordReset } = useAuth();

  // A login attempt by a user whose password was reset routes here automatically.
  if (needsPasswordReset || screen === 'forgotPassword') {
    return (
      <ForgotPassword
        initialEmail={needsPasswordReset ? resetEmail : ''}
        onBack={() => { clearPasswordReset(); setScreen('login'); }}
      />
    );
  }

  return <LoginForm onForgotPassword={() => setScreen('forgotPassword')} />;
};

export default AuthRouter;
