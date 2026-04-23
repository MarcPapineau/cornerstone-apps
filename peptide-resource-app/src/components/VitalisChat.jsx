// ============================================================================
// VitalisChat.jsx — persistent bottom-right chat widget
// ============================================================================
// Collapsible floating widget. Intake gate. Dark + gold aesthetic.
// Structured output rendering (markdown tables, T1/T2/T3 badges).
// "Send stack to Marc" submits to GHL proxy.
//
// Design:
//  - Fixed bottom-right.
//  - Collapsed: 56px gold circle button, "Ask Vitalis" tooltip.
//  - Expanded: ~400px × 600px panel, dark bg #0a1628, gold accents #d4af37.
//  - Full-screen overlay option for mobile.
//
// Dependencies: none new — pure React + inline CSS.
// ============================================================================

import { useState, useEffect, useRef, useMemo } from 'react';
import { sendMessage, sendStackToMarc } from '../api/claudeChat.js';
import catalogData from '../data/catalog-data.json';
import {
  INTAKE_SCHEMA,
  EVIDENCE_MODES,
  DEFAULT_EVIDENCE_MODE,
  moderateMessage,
} from '../data/vitalis-chat-config.js';

// ---------- theme tokens (inline — Tailwind crg-* classes aren't defined) ----
const T = {
  bg: '#0a1628',
  bgRaised: '#0f1e36',
  gold: '#d4af37',
  goldSoft: 'rgba(212,175,55,0.2)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  border: 'rgba(255,255,255,0.08)',
  borderGold: 'rgba(212,175,55,0.25)',
  danger: '#ef4444',
  warn: '#f59e0b',
  ok: '#10b981',
};

const TIER_COLORS = {
  T1: { bg: 'rgba(16,185,129,0.12)', color: '#10b981', border: 'rgba(16,185,129,0.35)' },
  T2: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.35)' },
  T3: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', border: 'rgba(239,68,68,0.35)' },
};

// ---------- localStorage keys ------------------------------------------------
const LS_KEYS = {
  ageGate: 'vitalis_chat_age_gate_v1',
  intake: 'vitalis_chat_intake_v1',
  history: 'vitalis_chat_history_v1',
  evidenceMode: 'vitalis_chat_evidence_mode_v1',
  collapsed: 'vitalis_chat_collapsed_v1',
};

// ============================================================================
// Main export
// ============================================================================
export default function VitalisChat() {
  // Stage machine: 'age-gate' -> 'intake' -> 'chat'
  const [stage, setStage] = useState('age-gate');
  const [collapsed, setCollapsed] = useState(true);

  const [intake, setIntake] = useState(null);
  const [history, setHistory] = useState([]); // [{role, content, ts, protocolId?, cost?}]
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const [evidenceMode, setEvidenceMode] = useState(DEFAULT_EVIDENCE_MODE);
  const [error, setError] = useState(null);
  const [lastProtocolId, setLastProtocolId] = useState(null);
  const [sendingToMarc, setSendingToMarc] = useState(false);
  const [sentToMarcOk, setSentToMarcOk] = useState(false);

  const scrollRef = useRef(null);

  // --------- boot: rehydrate localStorage ----------------------------------
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEYS.ageGate) === 'yes') {
        const storedIntake = localStorage.getItem(LS_KEYS.intake);
        if (storedIntake) {
          const parsed = JSON.parse(storedIntake);
          setIntake(parsed);
          setStage('chat');
        } else {
          setStage('intake');
        }
      }
      const storedHistory = localStorage.getItem(LS_KEYS.history);
      if (storedHistory) {
        setHistory(JSON.parse(storedHistory));
      }
      const storedMode = localStorage.getItem(LS_KEYS.evidenceMode);
      if (storedMode && EVIDENCE_MODES[storedMode]) {
        setEvidenceMode(storedMode);
      }
      const storedCollapsed = localStorage.getItem(LS_KEYS.collapsed);
      if (storedCollapsed === 'false') setCollapsed(false);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  // --------- persist on change ---------------------------------------------
  useEffect(() => {
    try { localStorage.setItem(LS_KEYS.history, JSON.stringify(history.slice(-30))); } catch {}
  }, [history]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEYS.evidenceMode, evidenceMode); } catch {}
  }, [evidenceMode]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEYS.collapsed, String(collapsed)); } catch {}
  }, [collapsed]);

  // --------- auto-scroll to bottom on new message --------------------------
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, pending, collapsed]);

  // --------- send ----------------------------------------------------------
  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || pending) return;

    // Client-side moderation pre-flight (defense-in-depth; server also checks)
    const mod = moderateMessage(trimmed);
    if (mod.flagged && mod.trigger.severity === 'block') {
      setHistory(h => [
        ...h,
        { role: 'user', content: trimmed, ts: Date.now() },
        { role: 'assistant', content: mod.trigger.response, ts: Date.now(), moderation: mod },
      ]);
      setInput('');
      return;
    }

    setError(null);
    setPending(true);
    setSentToMarcOk(false);

    const newHistory = [...history, { role: 'user', content: trimmed, ts: Date.now() }];
    setHistory(newHistory);
    setInput('');

    try {
      const res = await sendMessage({
        userMessage: trimmed,
        history: newHistory.map(m => ({ role: m.role, content: m.content })),
        intake,
        catalog: catalogData,
        evidenceMode,
      });

      if (!res.ok) {
        setError(res.error || 'Chat error');
        setHistory(h => [
          ...h,
          {
            role: 'assistant',
            content: res.httpStatus === 503
              ? 'Chat is temporarily offline. Please use the "Book Consult" button to reach Marc directly.'
              : `I hit an error: ${res.error || 'unknown'}. Try again in a moment.`,
            ts: Date.now(),
            error: true,
          },
        ]);
        return;
      }

      setLastProtocolId(res.protocolId);
      setHistory(h => [
        ...h,
        {
          role: 'assistant',
          content: res.text,
          ts: Date.now(),
          protocolId: res.protocolId,
          cost: res.costUsd,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          model: res.model,
        },
      ]);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setPending(false);
    }
  }

  // --------- send to marc --------------------------------------------------
  async function handleSendToMarc() {
    // Find the most recent assistant protocol
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant' && !m.error);
    if (!lastAssistant) return;

    setSendingToMarc(true);
    const res = await sendStackToMarc({
      intake,
      protocolMarkdown: lastAssistant.content,
      protocolId: lastAssistant.protocolId,
      userEmail: intake?.email || undefined,
      userName: intake?.name || undefined,
    });
    setSendingToMarc(false);
    if (res.ok) {
      setSentToMarcOk(true);
      setTimeout(() => setSentToMarcOk(false), 4000);
    } else {
      setError(`Send to Marc failed: ${res.error}`);
    }
  }

  function handleAgeYes() {
    try { localStorage.setItem(LS_KEYS.ageGate, 'yes'); } catch {}
    setStage('intake');
  }

  function handleIntakeComplete(data) {
    setIntake(data);
    try { localStorage.setItem(LS_KEYS.intake, JSON.stringify(data)); } catch {}
    setStage('chat');
  }

  function handleResetIntake() {
    if (!confirm('Reset your intake and clear chat history?')) return;
    setIntake(null);
    setHistory([]);
    try {
      localStorage.removeItem(LS_KEYS.intake);
      localStorage.removeItem(LS_KEYS.history);
    } catch {}
    setStage('intake');
  }

  // ---------------- render -------------------------------------------------
  if (collapsed) {
    return <FloatingButton onClick={() => setCollapsed(false)} />;
  }

  return (
    <div
      role="complementary"
      aria-label="Vitalis peptide chat"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 'min(420px, calc(100vw - 32px))',
        height: 'min(640px, calc(100vh - 48px))',
        background: T.bg,
        border: `1px solid ${T.borderGold}`,
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(212,175,55,0.1)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: T.textPrimary,
      }}
    >
      <ChatHeader
        stage={stage}
        evidenceMode={evidenceMode}
        onSetMode={setEvidenceMode}
        onReset={stage === 'chat' ? handleResetIntake : null}
        onCollapse={() => setCollapsed(true)}
      />

      <DisclaimerBanner />

      {stage === 'age-gate' && <AgeGate onYes={handleAgeYes} />}
      {stage === 'intake' && <IntakeForm onComplete={handleIntakeComplete} />}
      {stage === 'chat' && (
        <>
          <MessageList
            history={history}
            pending={pending}
            scrollRef={scrollRef}
          />
          {lastProtocolId && history.length > 0 && history[history.length - 1]?.role === 'assistant' && (
            <SendToMarcBar
              sending={sendingToMarc}
              sentOk={sentToMarcOk}
              onSend={handleSendToMarc}
            />
          )}
          {error && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: T.danger, fontSize: 12, borderTop: `1px solid ${T.border}` }}>
              {error}
            </div>
          )}
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            pending={pending}
          />
        </>
      )}
    </div>
  );
}

// ============================================================================
// Floating button (collapsed state)
// ============================================================================
function FloatingButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open Vitalis chat"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 60,
        height: 60,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${T.gold} 0%, #b8962f 100%)`,
        color: T.bg,
        border: 'none',
        boxShadow: '0 8px 24px rgba(212,175,55,0.45), 0 0 0 4px rgba(212,175,55,0.1)',
        fontSize: 26,
        cursor: 'pointer',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
      onMouseOver={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
      onMouseOut={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      title="Ask Vitalis — peptide research assistant"
    >
      <span aria-hidden>💬</span>
    </button>
  );
}

// ============================================================================
// Chat header
// ============================================================================
function ChatHeader({ stage, evidenceMode, onSetMode, onReset, onCollapse }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: T.bgRaised,
      borderBottom: `1px solid ${T.borderGold}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `linear-gradient(135deg, ${T.gold}, #b8962f)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>🏥</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary }}>
            Vitalis <span style={{ color: T.gold }}>Chat</span>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted }}>
            Peptide research assistant
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {stage === 'chat' && (
          <select
            value={evidenceMode}
            onChange={e => onSetMode(e.target.value)}
            aria-label="Evidence mode"
            style={{
              background: T.bg,
              color: T.textSecondary,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: '4px 6px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {Object.values(EVIDENCE_MODES).map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
        {onReset && (
          <IconButton title="Reset intake" onClick={onReset}>↺</IconButton>
        )}
        <IconButton title="Minimize" onClick={onCollapse}>✕</IconButton>
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${T.border}`,
        color: T.textSecondary,
        width: 28, height: 28,
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{children}</button>
  );
}

// ============================================================================
// Disclaimer banner (always visible)
// ============================================================================
function DisclaimerBanner() {
  return (
    <div style={{
      padding: '8px 14px',
      background: 'rgba(212,175,55,0.06)',
      borderBottom: `1px solid ${T.border}`,
      fontSize: 11,
      lineHeight: 1.45,
      color: T.textSecondary,
    }}>
      <strong style={{ color: T.gold }}>Research purposes only.</strong> Not medical advice. Consult your physician before any protocol.
    </div>
  );
}

// ============================================================================
// Age gate (shown once per session)
// ============================================================================
function AgeGate({ onYes }) {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
      <h3 style={{ margin: 0, fontSize: 16, color: T.textPrimary }}>Before we start</h3>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: T.textSecondary }}>
        Vitalis provides peptide research for adults 18 years or older. By continuing, you confirm you are 18+ and understand this is research guidance, not medical advice.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <PrimaryButton onClick={onYes}>I confirm — I am 18+</PrimaryButton>
      </div>
    </div>
  );
}

// ============================================================================
// Intake form (shown once; answers persist in localStorage)
// ============================================================================
function IntakeForm({ onComplete }) {
  const [data, setData] = useState({
    age: '',
    sex: '',
    weight: '',
    goals: [],
    medications: '',
    conditions: '',
    allergies: '',
    athlete: false,
    pregnancy: false,
    cancer: false,
    cancerType: '',
  });

  const valid = useMemo(() => {
    return (
      Number(data.age) >= 18 &&
      Number(data.age) <= 120 &&
      !!data.sex &&
      !!data.weight?.trim() &&
      data.goals.length > 0
    );
  }, [data]);

  function toggleGoal(g) {
    setData(d => ({
      ...d,
      goals: d.goals.includes(g) ? d.goals.filter(x => x !== g) : [...d.goals, g],
    }));
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <h3 style={{ margin: 0, fontSize: 15, color: T.textPrimary }}>Quick intake</h3>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        Every contraindication check runs against this intake. Nothing is shared until you tap "Send to Marc."
      </p>

      <Row>
        <Field label="Age *">
          <input type="number" min="18" max="120" value={data.age} onChange={e => setData({ ...data, age: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Sex *">
          <select value={data.sex} onChange={e => setData({ ...data, sex: e.target.value })} style={inputStyle}>
            <option value="">—</option>
            {INTAKE_SCHEMA.sex.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </Row>

      <Field label="Weight (e.g. 185 lbs or 84 kg) *">
        <input type="text" value={data.weight} onChange={e => setData({ ...data, weight: e.target.value })} style={inputStyle} placeholder="185 lbs" />
      </Field>

      <Field label="Goals * (pick all that apply)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {INTAKE_SCHEMA.goals.options.map(g => {
            const on = data.goals.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGoal(g)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 14,
                  border: `1px solid ${on ? T.gold : T.border}`,
                  background: on ? 'rgba(212,175,55,0.15)' : 'transparent',
                  color: on ? T.gold : T.textSecondary,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >{g}</button>
            );
          })}
        </div>
      </Field>

      <Field label="Current medications (prescription + OTC)">
        <textarea value={data.medications} onChange={e => setData({ ...data, medications: e.target.value })} style={{ ...inputStyle, minHeight: 50 }} />
      </Field>

      <Field label="Medical conditions">
        <textarea value={data.conditions} onChange={e => setData({ ...data, conditions: e.target.value })} style={{ ...inputStyle, minHeight: 50 }} />
      </Field>

      <Field label="Allergies (peptides, excipients, food)">
        <textarea value={data.allergies} onChange={e => setData({ ...data, allergies: e.target.value })} style={{ ...inputStyle, minHeight: 40 }} />
      </Field>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <CheckRow
          checked={data.athlete}
          onChange={v => setData({ ...data, athlete: v })}
          label="WADA-tested athlete (banned-substance screening)"
        />
        <CheckRow
          checked={data.pregnancy}
          onChange={v => setData({ ...data, pregnancy: v })}
          label="Pregnant, nursing, or trying to conceive"
        />
        <CheckRow
          checked={data.cancer}
          onChange={v => setData({ ...data, cancer: v })}
          label="Cancer history (any type, any remission length)"
        />
        {data.cancer && (
          <Field label="Cancer type (if yes)">
            <input type="text" value={data.cancerType} onChange={e => setData({ ...data, cancerType: e.target.value })} style={inputStyle} />
          </Field>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <PrimaryButton disabled={!valid} onClick={() => onComplete(data)}>
          Start chat
        </PrimaryButton>
        {!valid && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>Required: age, sex, weight, at least one goal.</div>}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  background: T.bg,
  color: T.textPrimary,
  fontSize: 12,
  fontFamily: 'inherit',
  resize: 'vertical',
};

function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
function CheckRow({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: T.textPrimary }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ============================================================================
// Message list + rendering
// ============================================================================
function MessageList({ history, pending, scrollRef }) {
  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {history.length === 0 && !pending && <WelcomeMessage />}
      {history.map((m, i) => (
        <MessageBubble key={i} msg={m} />
      ))}
      {pending && <Spinner />}
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'rgba(212,175,55,0.06)',
      border: `1px solid ${T.borderGold}`,
      borderRadius: 12,
      fontSize: 13,
      color: T.textPrimary,
      lineHeight: 1.55,
    }}>
      <strong style={{ color: T.gold }}>Ask me about a peptide stack.</strong>
      <br />
      Try:
      <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, color: T.textSecondary }}>
        <li>"I'm 42, 210 lbs, want to lose 40 lbs while keeping muscle."</li>
        <li>"Post-ACL surgery — what healing stack do you recommend?"</li>
        <li>"45 year old executive — foundational peptide baseline."</li>
      </ul>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4 }}>
      <div style={{
        maxWidth: '92%',
        padding: '10px 12px',
        borderRadius: 12,
        background: isUser ? 'rgba(212,175,55,0.14)' : T.bgRaised,
        border: `1px solid ${isUser ? T.borderGold : T.border}`,
        color: T.textPrimary,
        fontSize: 13,
        lineHeight: 1.55,
      }}>
        {isUser ? <span>{msg.content}</span> : <AssistantContent text={msg.content} />}
      </div>
      {!isUser && msg.protocolId && (
        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: 'monospace' }}>
          {msg.protocolId} · {msg.model || 'claude'} · {msg.tokensIn || 0}→{msg.tokensOut || 0} tok
        </div>
      )}
    </div>
  );
}

// ---------- minimal markdown renderer with T1/T2/T3 badges ------------------
function AssistantContent({ text }) {
  const blocks = useMemo(() => parseMarkdown(text || ''), [text]);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{blocks}</div>;
}

function parseMarkdown(raw) {
  const lines = raw.split('\n');
  const blocks = [];
  let buf = [];
  let tableBuf = [];
  let inCode = false;
  let codeBuf = [];

  const flushParagraph = () => {
    if (buf.length) {
      blocks.push(<Paragraph key={blocks.length} text={buf.join('\n')} />);
      buf = [];
    }
  };
  const flushTable = () => {
    if (tableBuf.length) {
      blocks.push(<MdTable key={blocks.length} lines={tableBuf} />);
      tableBuf = [];
    }
  };
  const flushCode = () => {
    if (codeBuf.length) {
      blocks.push(
        <pre key={blocks.length} style={{
          background: T.bg, border: `1px solid ${T.border}`,
          borderRadius: 6, padding: '8px 10px',
          fontSize: 11, overflowX: 'auto', margin: 0,
          color: T.textSecondary, fontFamily: 'Menlo, Monaco, monospace',
        }}>{codeBuf.join('\n')}</pre>
      );
      codeBuf = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; } else { flushParagraph(); flushTable(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // Tables: rows starting with |
    if (line.trim().startsWith('|') && line.includes('|')) {
      flushParagraph();
      tableBuf.push(line);
      continue;
    } else {
      flushTable();
    }

    // Headers
    if (/^#{1,6}\s/.test(line)) {
      flushParagraph();
      const level = (line.match(/^#+/) || ['#'])[0].length;
      const content = line.replace(/^#+\s*/, '');
      blocks.push(<Header key={blocks.length} level={level} text={content} />);
      continue;
    }

    // Blockquote (disclaimers)
    if (line.startsWith('>')) {
      flushParagraph();
      blocks.push(
        <div key={blocks.length} style={{
          borderLeft: `3px solid ${T.gold}`,
          padding: '8px 12px',
          background: 'rgba(212,175,55,0.06)',
          borderRadius: 4,
          fontSize: 12,
          color: T.textSecondary,
          lineHeight: 1.5,
        }}>
          <InlineText text={line.replace(/^>\s*/, '')} />
        </div>
      );
      continue;
    }

    // Bullet list
    if (/^[*-]\s/.test(line)) {
      buf.push(line);
      continue;
    }
    // Paragraph line
    buf.push(line);
  }
  flushParagraph();
  flushTable();
  flushCode();
  return blocks;
}

function Header({ level, text }) {
  const size = { 1: 15, 2: 14, 3: 13, 4: 13, 5: 12, 6: 12 }[level] || 13;
  const weight = level <= 2 ? 700 : 600;
  return (
    <div style={{
      fontSize: size, fontWeight: weight, color: level <= 2 ? T.gold : T.textPrimary,
      marginTop: level <= 2 ? 6 : 2,
    }}>
      <InlineText text={text} />
    </div>
  );
}

function Paragraph({ text }) {
  // Split into lines; detect bullets
  const lines = text.split('\n');
  const bullets = [];
  const other = [];
  for (const l of lines) {
    if (/^[*-]\s/.test(l)) bullets.push(l.replace(/^[*-]\s*/, ''));
    else if (l.trim()) other.push(l);
  }
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: T.textPrimary }}>
      {other.length > 0 && (
        <div style={{ marginBottom: bullets.length ? 6 : 0 }}>
          {other.map((l, i) => (
            <div key={i}><InlineText text={l} /></div>
          ))}
        </div>
      )}
      {bullets.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ marginBottom: 3 }}><InlineText text={b} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MdTable({ lines }) {
  // Parse | col1 | col2 | rows
  const rows = lines
    .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
    .filter(cells => cells.length > 0);

  if (!rows.length) return null;
  // Drop the separator row (|---|---|)
  const clean = rows.filter(r => !r.every(c => /^:?-+:?$/.test(c)));
  if (!clean.length) return null;

  const [head, ...body] = clean;
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 6 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
        <thead>
          <tr style={{ background: T.bgRaised }}>
            {head.map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '6px 8px', color: T.gold, fontWeight: 700, borderBottom: `1px solid ${T.border}` }}>
                <InlineText text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '6px 8px', color: T.textSecondary, verticalAlign: 'top' }}>
                  <InlineText text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Inline text renderer: **bold**, `code`, and T1/T2/T3 badges
function InlineText({ text }) {
  if (!text) return null;
  // Split on T1/T2/T3 markers first so we can wrap them as badges
  const parts = [];
  const regex = /\[T([123])(:[^\]]+)?\]/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', content: text.slice(last, match.index) });
    }
    parts.push({ type: 'tier', tier: `T${match[1]}`, meta: match[2] ? match[2].slice(1).trim() : null });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', content: text.slice(last) });
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'tier') {
          const c = TIER_COLORS[p.tier];
          return (
            <span key={i}
              title={p.meta || p.tier}
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                margin: '0 2px',
                borderRadius: 10,
                background: c.bg,
                color: c.color,
                border: `1px solid ${c.border}`,
                fontSize: 10,
                fontWeight: 700,
                verticalAlign: 'baseline',
                cursor: p.meta ? 'help' : 'default',
              }}
            >{p.tier}{p.meta ? ` ${p.meta.slice(0, 24)}${p.meta.length > 24 ? '…' : ''}` : ''}</span>
          );
        }
        return <span key={i}>{renderInlineFormatting(p.content)}</span>;
      })}
    </>
  );
}

function renderInlineFormatting(text) {
  // **bold** and `code`
  const parts = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        parts.push(<strong key={parts.length} style={{ color: T.textPrimary }}>{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        parts.push(<code key={parts.length} style={{
          background: T.bg, padding: '1px 4px', borderRadius: 3,
          fontFamily: 'Menlo, Monaco, monospace', fontSize: 11,
          color: T.gold,
        }}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    // take a chunk until the next markup char
    const nextBold = text.indexOf('**', i);
    const nextCode = text.indexOf('`', i);
    let next = text.length;
    if (nextBold !== -1 && nextBold < next) next = nextBold;
    if (nextCode !== -1 && nextCode < next) next = nextCode;
    parts.push(<span key={parts.length}>{text.slice(i, next)}</span>);
    i = next;
  }
  return parts;
}

// ============================================================================
// Spinner, send bar, input
// ============================================================================
function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textMuted, fontSize: 12 }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        border: `2px solid ${T.goldSoft}`, borderTopColor: T.gold,
        animation: 'vitalis-spin 0.8s linear infinite',
      }} />
      Vitalis is researching…
      <style>{`@keyframes vitalis-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SendToMarcBar({ sending, sentOk, onSend }) {
  return (
    <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.border}`, background: T.bgRaised }}>
      <button
        onClick={onSend}
        disabled={sending}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 6,
          border: `1px solid ${T.borderGold}`,
          background: sentOk ? 'rgba(16,185,129,0.15)' : 'rgba(212,175,55,0.12)',
          color: sentOk ? T.ok : T.gold,
          fontSize: 12,
          fontWeight: 700,
          cursor: sending ? 'wait' : 'pointer',
          opacity: sending ? 0.6 : 1,
        }}
      >
        {sentOk ? '✓ Sent to Marc' : sending ? 'Sending…' : 'Send this stack to Marc'}
      </button>
    </div>
  );
}

function ChatInput({ value, onChange, onSend, pending }) {
  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }
  return (
    <div style={{
      padding: 10,
      borderTop: `1px solid ${T.border}`,
      background: T.bgRaised,
      display: 'flex',
      gap: 8,
      alignItems: 'flex-end',
    }}>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Ask about a peptide stack…"
        rows={2}
        style={{
          flex: 1,
          padding: '8px 10px',
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          background: T.bg,
          color: T.textPrimary,
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'none',
          minHeight: 36,
          maxHeight: 120,
        }}
      />
      <button
        onClick={onSend}
        disabled={pending || !value.trim()}
        style={{
          padding: '8px 14px',
          borderRadius: 6,
          border: 'none',
          background: pending || !value.trim() ? 'rgba(212,175,55,0.3)' : T.gold,
          color: T.bg,
          fontSize: 13,
          fontWeight: 700,
          cursor: pending || !value.trim() ? 'not-allowed' : 'pointer',
        }}
      >Send</button>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 16px',
        borderRadius: 8,
        border: 'none',
        background: disabled ? 'rgba(212,175,55,0.3)' : T.gold,
        color: T.bg,
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{children}</button>
  );
}
