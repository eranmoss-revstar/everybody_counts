import React, { useState } from 'react';
import LoginForm from './LoginForm';
import ForgotPassword from './ForgotPassword';

type Screen = 'login' | 'forgotPassword';

const AuthRouter: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('login');

  if (screen === 'forgotPassword') {
    return <ForgotPassword onBack={() => setScreen('login')} />;
  }

  return <LoginForm onForgotPassword={() => setScreen('forgotPassword')} />;
};

export default AuthRouter;
