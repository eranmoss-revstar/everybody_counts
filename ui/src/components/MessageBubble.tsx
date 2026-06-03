import React, { useState, useEffect } from 'react';
import { Copy, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { MessageBubbleProps } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { formatMessageContent } from '../utils/formatters';

// ─── Content block types ──────────────────────────────────────────────────────

type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'src'; name: string };

type Block =
  | { kind: 'title'; parts: InlinePart[] }
  | { kind: 'section'; label: InlinePart[]; bullets: InlinePart[][] }
  | { kind: 'bullets'; items: InlinePart[][] }
  | { kind: 'paragraph'; parts: InlinePart[] };

// Link lookup (source filename → presigned URL), provided per message.
const LinkMapContext = React.createContext<Record<string, string>>({});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Tokenise a line into text, **bold**, and [[src:FILENAME]] parts.
function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /\*\*(.*?)\*\*|\[\[src:\s*([^\]]+?)\s*\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ type: 'bold', text: m[1] });
    else if (m[2] !== undefined) parts.push({ type: 'src', name: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

function isBullet(line: string) {
  return /^[-*]\s+/.test(line.trim());
}

function bulletText(line: string): InlinePart[] {
  return parseInline(line.trim().replace(/^[-*]\s+/, ''));
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
      blocks.push({ kind: 'title', parts: parseInline(titleMatch[1]) });
      i++; continue;
    }

    // Line that is just hashes with no space (malformed heading) — skip
    if (/^#{1,6}$/.test(trimmed)) { i++; continue; }

    // **Bold label:** section — collect following bullets
    const sectionMatch = trimmed.match(/^\*\*(.+:)\*\*\s*$/);
    if (sectionMatch) {
      const label = parseInline(`**${sectionMatch[1]}**`);
      const bullets: InlinePart[][] = [];
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
      const items: InlinePart[][] = [bulletText(trimmed)];
      i++;
      while (i < lines.length && isBullet(lines[i])) {
        items.push(bulletText(lines[i])); i++;
      }
      blocks.push({ kind: 'bullets', items });
      continue;
    }

    // Paragraph
    blocks.push({ kind: 'paragraph', parts: parseInline(trimmed) });
    i++;
  }

  return blocks;
}

// ─── Inline renderer (bold + source link chips) ────────────────────────────────

function SourceChip({ name }: { name: string }) {
  const linkMap = React.useContext(LinkMapContext);
  const url = linkMap[name] || linkMap[name.replace(/\.(pdf|pptx|docx)$/i, '')];
  const label = name.replace(/\.(pdf|pptx|docx)$/i, '');
  if (!url) {
    // No matching document — render a subtle non-link label rather than raw marker
    return <span className="opacity-50 text-xs"> ({label})</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the original teaching document"
      className="inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 py-0.5 rounded-md text-xs no-underline bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 transition-colors"
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  );
}

function Inline({ parts }: { parts: InlinePart[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'bold') return <strong key={i} className="font-bold">{p.text}</strong>;
        if (p.type === 'src') return <SourceChip key={i} name={p.name} />;
        return <React.Fragment key={i}>{p.text}</React.Fragment>;
      })}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const WORDS_PER_SEC = 25;

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
  const linkMap: Record<string, string> = {};
  (message.metadata?.sourceLinks || []).forEach(l => {
    linkMap[l.name] = l.url;
    linkMap[l.name.replace(/\.(pdf|pptx|docx)$/i, '')] = l.url;
  });

  return (
    <LinkMapContext.Provider value={linkMap}>
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
                  <Inline parts={block.parts} />
                </p>
              );
            }

            if (block.kind === 'section') {
              return (
                <div key={idx} className="flex gap-2">
                  <div className={`flex-shrink-0 font-bold w-48 ${
                    isDarkMode ? 'text-slate-100' : 'text-slate-900'
                  }`}>
                    <Inline parts={block.label} />
                  </div>
                  <div className="flex-1 space-y-1">
                    {block.bullets.length === 0 && <span className="opacity-40">—</span>}
                    {block.bullets.map((parts, bi) => (
                      <div key={bi} className="flex gap-1.5">
                        <span className="flex-shrink-0 mt-px">•</span>
                        <span><Inline parts={parts} /></span>
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
                      <span><Inline parts={parts} /></span>
                    </div>
                  ))}
                </div>
              );
            }

            if (block.kind === 'paragraph') {
              return (
                <p key={idx}>
                  <Inline parts={block.parts} />
                </p>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
    </LinkMapContext.Provider>
  );
};

export default MessageBubble;
