import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../auth/AuthContext';

// Shown on first login for admin-created users (Cognito NEW_PASSWORD_REQUIRED).
// They set their own password and are then signed in.
const SetNewPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { completeNewPassword } = useAuth();
  const { isDarkMode } = useTheme();

  // Mirrors the Cognito pool policy: 8+ chars, upper, lower, number, symbol.
  const validate = (p: string): string | null => {
    if (p.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(p)) return 'Include at least one uppercase letter.';
    if (!/[a-z]/.test(p)) return 'Include at least one lowercase letter.';
    if (!/[0-9]/.test(p)) return 'Include at least one number.';
    if (!/[^A-Za-z0-9]/.test(p)) return 'Include at least one symbol.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    const v = validate(password);
    if (v) { setError(v); return; }

    setIsSubmitting(true);
    try {
      await completeNewPassword(password);
    } catch (err: any) {
      setError(err.message || 'Could not set your password.');
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
        <h2 className={`text-2xl font-bold transition-colors duration-300 ${
          isDarkMode ? 'text-slate-100' : 'text-slate-900'
        }`}>
          Set Your Password
        </h2>
        <p className={`text-sm mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          This is your first sign-in. Choose a password to finish setting up your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelClass}>New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter a new password"
            className={inputClass}
            autoFocus
            required
          />
          <p className={`text-xs mt-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            At least 8 characters, with an uppercase letter, a number, and a symbol.
          </p>
        </div>

        <div>
          <label className={labelClass}>Confirm password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter the password"
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

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-2.5 px-4 rounded-xl font-medium transition-all duration-200 ${
            isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'
          } bg-blue-600 hover:bg-blue-700 text-white shadow-lg`}
        >
          {isSubmitting ? 'Setting password…' : 'Set Password & Continue'}
        </button>
      </form>
    </div>
  );
};

export default SetNewPassword;
