import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../auth/AuthContext';

interface ForgotPasswordProps {
  onBack: () => void;
  initialEmail?: string;
}

const ForgotPassword: React.FC<ForgotPasswordProps> = ({ onBack, initialEmail = '' }) => {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { forgotPassword, confirmPassword: confirmPwd } = useAuth();
  const { isDarkMode } = useTheme();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await forgotPassword(email);
      if (result.success) {
        setStep('reset');
        setMessage('Reset code sent to your email');
      } else {
        setError(result.error || 'Failed to send reset code');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send reset code');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await confirmPwd(email, code, newPassword);
      if (result.success) {
        setMessage('Password reset successfully! Redirecting to login...');
        setTimeout(onBack, 2000);
      } else {
        setError(result.error || 'Password reset failed');
      }
    } catch (err: any) {
      setError(err.message || 'Password reset failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = `w-full px-4 py-2.5 rounded-xl border transition-all duration-200 ${
    isDarkMode
      ? 'bg-slate-700/80 border-slate-600 text-slate-100 placeholder-slate-400 focus:border-blue-500'
      : 'bg-white border-slate-300 text-slate-900 placeholder-slate-500 focus:border-blue-500'
  } focus:outline-none focus:ring-2 focus:ring-blue-500/20`;

  const labelClass = `block text-sm font-medium mb-1.5 ${
    isDarkMode ? 'text-slate-300' : 'text-slate-700'
  }`;

  return (
    <div className={`p-8 rounded-2xl border shadow-xl transition-all duration-300 w-full max-w-md ${
      isDarkMode
        ? 'bg-slate-800/90 border-slate-700/50 backdrop-blur-sm'
        : 'bg-white/90 border-slate-200/50 backdrop-blur-sm'
    }`}>
      <div className="text-center mb-6">
        <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
          {step === 'email' ? 'Reset Password' : 'Set New Password'}
        </h2>
        <p className={`text-sm mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {step === 'email'
            ? (initialEmail
                ? 'Your password needs to be reset. Send a code to your email to set a new one.'
                : 'Enter your email to receive a reset code')
            : `Enter the code sent to ${email}`}
        </p>
      </div>

      {step === 'email' ? (
        <form onSubmit={handleSendCode} className="space-y-5">
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={inputClass}
              required
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

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-2.5 px-4 rounded-xl font-medium transition-all duration-200 ${
              isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'
            } bg-blue-600 hover:bg-blue-700 text-white shadow-lg`}
          >
            {isSubmitting ? 'Sending...' : 'Send Reset Code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label className={labelClass}>Verification Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className={`${inputClass} text-center text-xl tracking-widest`}
              required
              maxLength={6}
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass}>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 characters"
              className={inputClass}
              required
              minLength={8}
            />
          </div>

          <div>
            <label className={labelClass}>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className={inputClass}
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

          {message && (
            <div className={`p-3 rounded-xl text-sm ${
              isDarkMode ? 'bg-green-900/30 text-green-300 border border-green-800/50' : 'bg-green-50 text-green-700 border border-green-200'
            }`}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-2.5 px-4 rounded-xl font-medium transition-all duration-200 ${
              isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'
            } bg-blue-600 hover:bg-blue-700 text-white shadow-lg`}
          >
            {isSubmitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      )}

      <div className="mt-5 text-center">
        <button
          onClick={onBack}
          className={`text-sm transition-colors duration-200 ${
            isDarkMode ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Back to login
        </button>
      </div>
    </div>
  );
};

export default ForgotPassword;
