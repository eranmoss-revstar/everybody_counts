import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../auth/AuthContext';

interface LoginFormProps {
  onForgotPassword: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onForgotPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, authMode } = useAuth();
  const { isDarkMode } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`p-8 rounded-2xl border shadow-xl transition-all duration-300 w-full max-w-md ${
      isDarkMode
        ? 'bg-slate-800/90 border-slate-700/50 backdrop-blur-sm'
        : 'bg-white/90 border-slate-200/50 backdrop-blur-sm'
    }`}>
      <div className="text-center mb-8">
        <h2 className={`text-2xl font-bold transition-colors duration-300 ${
          isDarkMode ? 'text-slate-100' : 'text-slate-900'
        }`}>
          Welcome Back
        </h2>
        {authMode === 'mock' && (
          <p className={`text-sm mt-2 transition-colors duration-300 ${
            isDarkMode ? 'text-slate-400' : 'text-slate-500'
          }`}>
            Demo login: testuser / demo123
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${
            isDarkMode ? 'text-slate-300' : 'text-slate-700'
          }`}>
            Email
          </label>
          <input
            type={authMode === 'cognito' ? 'email' : 'text'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={authMode === 'cognito' ? 'you@company.com' : 'Enter username'}
            className={`w-full px-4 py-2.5 rounded-xl border transition-all duration-200 ${
              isDarkMode
                ? 'bg-slate-700/80 border-slate-600 text-slate-100 placeholder-slate-400 focus:border-blue-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-500 focus:border-blue-500'
            } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
            required
          />
        </div>

        <div>
          <label className={`block text-sm font-medium mb-1.5 ${
            isDarkMode ? 'text-slate-300' : 'text-slate-700'
          }`}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className={`w-full px-4 py-2.5 rounded-xl border transition-all duration-200 ${
              isDarkMode
                ? 'bg-slate-700/80 border-slate-600 text-slate-100 placeholder-slate-400 focus:border-blue-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-500 focus:border-blue-500'
            } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
            required
          />
        </div>

        {error && (
          <div className={`p-3 rounded-xl text-sm ${
            isDarkMode ? 'bg-red-900/30 text-red-300 border border-red-800/50' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-2.5 px-4 rounded-xl font-medium transition-all duration-200 ${
            isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'
          } bg-blue-600 hover:bg-blue-700 text-white shadow-lg`}
        >
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 space-y-3 text-center">
          <button
            onClick={onForgotPassword}
            className={`text-sm transition-colors duration-200 ${
              isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
            }`}
          >
            Forgot your password?
          </button>
        </div>
    </div>
  );
};

export default LoginForm;
