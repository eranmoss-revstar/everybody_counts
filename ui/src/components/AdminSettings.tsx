import React, { useState, useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getAdminSettings, updateAdminSettings } from '../services/api';

const LENGTH_OPTIONS = [
  { label: 'Brief', value: 400 },
  { label: 'Standard', value: 1000 },
  { label: 'Detailed', value: 2000 },
];

const TONE_OPTIONS = [
  { label: 'Precise', value: 0.2 },
  { label: 'Balanced', value: 0.7 },
  { label: 'Creative', value: 0.9 },
];

const AdminSettings: React.FC = () => {
  const { user, getIdToken } = useAuth();
  const { isDarkMode } = useTheme();
  const [open, setOpen] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.groups?.includes('admins') ?? false;

  useEffect(() => {
    if (!isAdmin) return;
    const token = getIdToken();
    if (!token) return;
    getAdminSettings(token)
      .then(s => { setTemperature(s.temperature); setMaxTokens(s.maxTokens); })
      .catch(() => {});
  }, [isAdmin, getIdToken]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const save = async (temp: number, tokens: number) => {
    const token = getIdToken();
    if (!token) return;
    setSaving(true);
    try {
      await updateAdminSettings(token, { temperature: temp, maxTokens: tokens });
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        title="LLM Settings (admin)"
        className={`p-2 rounded-lg transition-all duration-200 ${
          open
            ? isDarkMode ? 'bg-slate-700 text-blue-400' : 'bg-blue-50 text-blue-600'
            : isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
        }`}
      >
        <SlidersHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div className={`absolute right-0 top-10 z-50 w-60 rounded-xl shadow-xl border p-4 space-y-4 ${
          isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <p className={`text-xs font-semibold uppercase tracking-wide ${
            isDarkMode ? 'text-slate-400' : 'text-slate-500'
          }`}>
            {saving ? 'Saving…' : 'LLM Behaviour'}
          </p>

          <div>
            <p className={`text-xs mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Response Length</p>
            <div className="flex gap-1">
              {LENGTH_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setMaxTokens(opt.value); save(temperature, opt.value); }}
                  className={`flex-1 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                    maxTokens === opt.value
                      ? 'bg-blue-500 text-white font-medium'
                      : isDarkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={`text-xs mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Tone</p>
            <div className="flex gap-1">
              {TONE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setTemperature(opt.value); save(opt.value, maxTokens); }}
                  className={`flex-1 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                    temperature === opt.value
                      ? 'bg-blue-500 text-white font-medium'
                      : isDarkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSettings;
