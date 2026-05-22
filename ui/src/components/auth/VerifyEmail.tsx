import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../auth/AuthContext';

interface VerifyEmailProps {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}

const VerifyEmail: React.FC<VerifyEmailProps> = ({ email, onVerified, onBack }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { confirmSignUp, resendCode } = useAuth();
  const { isDarkMode } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);

    try {
      const result = await confirmSignUp(email, code);
      if (result.success) {
        setMessage('Email verified! Redirecting to login...');
        setTimeout(onVerified, 1500);
      } else {
        setError(result.error || 'Verification failed');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setMessage('');
    try {
      const result = await resendCode(email);
      if (result.success) {
        setMessage('New verification code sent');
      } else {
        setError(result.error || 'Failed to resend code');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend code');
    }
  };

  return (
    <div className={`p-8 rounded-2xl border shadow-xl transition-all duration-300 w-full max-w-md ${
      isDarkMode
        ? 'bg-slate-800/90 border-slate-700/50 backdrop-blur-sm'
        : 'bg-white/90 border-slate-200/50 backdrop-blur-sm'
    }`}>
      <div className="text-center mb-6">
        <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
          Verify Your Email
        </h2>
        <p className={`text-sm mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          We sent a verification code to <strong>{email}</strong>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${
            isDarkMode ? 'text-slate-300' : 'text-slate-700'
          }`}>
            Verification Code
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className={`w-full px-4 py-2.5 rounded-xl border text-center text-2xl tracking-widest transition-all duration-200 ${
              isDarkMode
                ? 'bg-slate-700/80 border-slate-600 text-slate-100 placeholder-slate-500 focus:border-blue-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500'
            } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
            required
            maxLength={6}
            autoFocus
          />
        </div>

        {error && (
          <div className={`p-3 rounded-xl text-sm ${
            isDarkMode ? 'bg-red-900/30 text-red-300 border border-red-800/50' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {error}
          </div>
        )}

        {message && (
          <div className={`p-3 rounded-xl text-sm ${
            isDarkMode ? 'bg-green-900/30 text-green-300 border border-green-800/50' : 'bg-green-50 text-green-700 border border-green-200'
          }`}>
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || code.length < 6}
          className={`w-full py-2.5 px-4 rounded-xl font-medium transition-all duration-200 ${
            isSubmitting || code.length < 6 ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'
          } bg-blue-600 hover:bg-blue-700 text-white shadow-lg`}
        >
          {isSubmitting ? 'Verifying...' : 'Verify Email'}
        </button>
      </form>

      <div className="mt-5 flex justify-between items-center">
        <button
          onClick={onBack}
          className={`text-sm transition-colors duration-200 ${
            isDarkMode ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Back to login
        </button>
        <button
          onClick={handleResend}
          className={`text-sm transition-colors duration-200 ${
            isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
          }`}
        >
          Resend code
        </button>
      </div>
    </div>
  );
};

export default VerifyEmail;
