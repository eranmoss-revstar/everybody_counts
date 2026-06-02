import React, { useState, useEffect } from 'react';
import { Copy, Check, AlertCircle } from 'lucide-react';
import { MessageBubbleProps } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { formatMessageContent } from '../utils/formatters';

// ─── Content block types ──────────────────────────────────────────────────────

type BoldPart = { bold: boolean; text: string };

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'section'; label: string; bullets: BoldPart[][] }
  | { kind: 'bullets'; items: BoldPart[][] }
  | { kind: 'paragraph'; parts: BoldPart[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBold(text: string): BoldPart[] {
  return text.split(/\*\*(.*?)\*\*/g).map((t, i) => ({ bold: i % 2 === 1, text: t }));
}

function isBullet(line: string) {
  return /^[-*]\s+/.test(line.trim());
}

function bulletText(line: string): BoldPart[] {
  return parseBold(line.trim().replace(/^[-*]\s+/, ''));
}

function parseContent(raw: string): Block[] {
  const lines = raw.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) { i++; continue; }

    // # / ## / ### title — strip all leading # characters
    const titleMatch = trimmed.match(/^#{1,6}\s+(.*)/);
    if (titleMatch) {
      blocks.push({ kind: 'title', text: titleMatch[1].replace(/\*\*/g, '') });
      i++; continue;
    }

    // Line that is just hashes with no space (malformed heading) — skip
    if (/^#{1,6}$/.test(trimmed)) { i++; continue; }

    // **Bold label:** section — collect following bullets
    const sectionMatch = trimmed.match(/^\*\*(.+:)\*\*\s*$/);
    if (sectionMatch) {
      const label = sectionMatch[1];
      const bullets: BoldPart[][] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (isBullet(next)) { bullets.push(bulletText(next)); i++; }
        else if (!next) { i++; break; }
        else break;
      }
      blocks.push({ kind: 'section', label, bullets });
      continue;
    }

    // Plain bullet(s)
    if (isBullet(trimmed)) {
      const items: BoldPart[][] = [bulletText(trimmed)];
      i++;
      while (i < lines.length && isBullet(lines[i])) {
        items.push(bulletText(lines[i])); i++;
      }
      blocks.push({ kind: 'bullets', items });
      continue;
    }

    // Paragraph
    blocks.push({ kind: 'paragraph', parts: parseBold(trimmed) });
    i++;
  }

  return blocks;
}

// ─── Inline bold renderer ─────────────────────────────────────────────────────

function BoldText({ parts }: { parts: BoldPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? <strong key={i} className="font-bold">{p.text}</strong> : <React.Fragment key={i}>{p.text}</React.Fragment>
      )}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const WORDS_PER_SEC = 60;

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isError = message.isError;
  const [copied, setCopied] = useState(false);
  const [displayed, setDisplayed] = useState('');
  const { isDarkMode } = useTheme();

  const safeRaw = typeof message.content === 'string' ? message.content : String(message.content ?? '');

  useEffect(() => {
    if (isUser || isError) { setDisplayed(safeRaw); return; }
    setDisplayed('');
    const words = safeRaw.split(' ');
    let i = 0;
    const ms = 1000 / WORDS_PER_SEC;
    const timer = setInterval(() => {
      i++;
      setDisplayed(words.slice(0, i).join(' '));
      if (i >= words.length) clearInterval(timer);
    }, ms);
    return () => clearInterval(timer);
  }, [safeRaw, isUser, isError]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(safeRaw);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = message.content;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── User bubble ────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="flex justify-end mb-5">
        <div className={`max-w-sm px-4 py-2.5 rounded-2xl text-sm leading-relaxed text-white ${
          isDarkMode ? 'bg-indigo-900/80 border border-indigo-700/50' : 'bg-indigo-600'
        }`}>
          {displayed}
        </div>
      </div>
    );
  }

  // ── Assistant card ─────────────────────────────────────────────────────────
  const blocks = parseContent(formatMessageContent(displayed));

  return (
    <div className="flex justify-start mb-5 group">
      <div className={`relative w-full rounded-2xl border px-6 py-5 ${
        isError
          ? isDarkMode
            ? 'bg-red-900/30 border-red-700/50 text-red-200'
            : 'bg-red-50 border-red-300 text-red-800'
          : isDarkMode
            ? 'bg-slate-800 border-slate-600/70 text-slate-100'
            : 'bg-white border-slate-300 text-slate-900'
      }`} style={{ fontFamily: "'Comic Sans MS', 'Comic Sans', cursive", fontSize: '15px', lineHeight: '1.75' }}>

        {/* Copy button */}
        {!isError && (
          <button
            onClick={handleCopy}
            title="Copy"
            className={`absolute top-3 right-3 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
              isDarkMode
                ? 'text-slate-500 hover:text-slate-200 hover:bg-slate-700'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-green-500" />
              : <Copy className="w-3.5 h-3.5" />
            }
          </button>
        )}

        {isError && <AlertCircle className="w-4 h-4 inline-block mr-2 text-red-500" />}

        {/* Content blocks */}
        <div className="space-y-4">
          {blocks.map((block, idx) => {
            if (block.kind === 'title') {
              return (
                <p key={idx} className="font-bold underline underline-offset-4 decoration-1 pb-1"
                   style={{ fontFamily: "'Comic Sans MS', 'Comic Sans', cursive", fontSize: '17px' }}>
                  {block.text}
                </p>
              );
            }

            if (block.kind === 'section') {
              return (
                <div key={idx} className="flex gap-2">
                  <div className={`flex-shrink-0 font-bold w-48 ${
                    isDarkMode ? 'text-slate-100' : 'text-slate-900'
                  }`}>
                    {block.label}
                  </div>
                  <div className="flex-1 space-y-1">
                    {block.bullets.length === 0 && <span className="opacity-40">—</span>}
                    {block.bullets.map((parts, bi) => (
                      <div key={bi} className="flex gap-1.5">
                        <span className="flex-shrink-0 mt-px">•</span>
                        <span><BoldText parts={parts} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (block.kind === 'bullets') {
              return (
                <div key={idx} className="space-y-1 pl-2">
                  {block.items.map((parts, bi) => (
                    <div key={bi} className="flex gap-1.5">
                      <span className="flex-shrink-0 mt-px">•</span>
                      <span><BoldText parts={parts} /></span>
                    </div>
                  ))}
                </div>
              );
            }

            if (block.kind === 'paragraph') {
              return (
                <p key={idx}>
                  <BoldText parts={block.parts} />
                </p>
              );
            }

            return null;
          })}
        </div>

        {/* Sources */}
        {message.metadata?.sources && message.metadata.sources.length > 0 && (
          <div className={`mt-4 pt-2 border-t text-xs ${
            isDarkMode ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-400'
          }`}>
            <span className="font-semibold">Sources: </span>
            {message.metadata.sources.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
