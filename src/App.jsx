import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { ref, set, onValue, get } from "firebase/database";

// ── Telegram Mini App SDK ──────────────────────────────────────────────────
const tg = window.Telegram?.WebApp;
const tgUser = tg?.initDataUnsafe?.user;

// Fallback for dev/browser testing outside Telegram
const ME = {
  id: tgUser?.id ?? "dev_" + Math.floor(Math.random() * 9999),
  name: tgUser?.first_name ?? "You (Dev)",
  username: tgUser?.username ?? "devuser",
};

const CHAT_ID = tg?.initDataUnsafe?.chat?.id ?? "dev_chat";
const POLL_ID = `poll_${CHAT_ID}`;

// ── Vote options ───────────────────────────────────────────────────────────
const OPTIONS = [
  {
    id: "yes",
    emoji: "🏠",
    label: "I'm Home!",
    sub: "Safe and sound",
    color: "#7ecfa0",
    bg: "rgba(126,207,160,0.13)",
    border: "rgba(126,207,160,0.35)",
  },
  {
    id: "otw",
    emoji: "🚶",
    label: "On the Way",
    sub: "Almost there",
    color: "#f9d56e",
    bg: "rgba(249,213,110,0.12)",
    border: "rgba(249,213,110,0.35)",
  },
  {
    id: "check",
    emoji: "🫂",
    label: "Check in on Me",
    sub: "I could use a nudge",
    color: "#f4a5c0",
    bg: "rgba(244,165,192,0.13)",
    border: "rgba(244,165,192,0.35)",
  },
];

// ── Tiny components ────────────────────────────────────────────────────────
function Pip({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function VoteButton({ opt, selected, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        background: selected ? opt.bg : "rgba(255,255,255,0.03)",
        border: `1.5px solid ${selected ? opt.border : "rgba(255,255,255,0.07)"}`,
        borderRadius: 16,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        cursor: disabled ? "default" : "pointer",
        transition: "all 0.25s ease",
        opacity: disabled && !selected ? 0.45 : 1,
        transform: selected ? "scale(1.02)" : "scale(1)",
      }}
    >
      <span style={{ fontSize: 28 }}>{opt.emoji}</span>
      <div style={{ textAlign: "left", flex: 1 }}>
        <div
          style={{
            color: selected ? opt.color : "#ccc",
            fontWeight: 700,
            fontSize: 15,
            fontFamily: "'Lora', serif",
            transition: "color 0.2s",
          }}
        >
          {opt.label}
        </div>
        <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>{opt.sub}</div>
      </div>
      {selected && (
        <span style={{ color: opt.color, fontSize: 18, marginLeft: "auto" }}>✓</span>
      )}
    </button>
  );
}

function MemberRow({ name, status }) {
  const opt = OPTIONS.find((o) => o.id === status);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 0",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: opt ? opt.bg : "rgba(255,255,255,0.06)",
          border: `1.5px solid ${opt ? opt.border : "rgba(255,255,255,0.1)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {opt ? opt.emoji : "⏳"}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#ddd", fontSize: 14, fontWeight: 600 }}>{name}</div>
        {opt ? (
          <div style={{ color: opt.color, fontSize: 12 }}>{opt.label}</div>
        ) : (
          <div style={{ color: "#444", fontSize: 12 }}>Waiting...</div>
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [votes, setVotes] = useState({});       // { userId: { name, status } }
  const [myVote, setMyVote] = useState(null);
  const [closed, setClosed] = useState(false);
  const [celebration, setCelebration] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const confettiItems = useRef([...Array(24)].map(() => ({
    emoji: ["🏠", "💛", "✨", "🎉", "💚", "🧡"][Math.floor(Math.random() * 6)],
    left: Math.random() * 100,
    delay: Math.random() * 1,
    dur: 1.4 + Math.random() * 0.8,
  })));

  // ── Sync from Firebase ──────────────────────────────────────────────────
  useEffect(() => {
    tg?.ready();
    tg?.expand();

    const pollRef = ref(db, `polls/${POLL_ID}`);
    const unsub = onValue(pollRef, (snap) => {
      const data = snap.val() ?? {};
      const v = data.votes ?? {};
      setVotes(v);
      setClosed(data.closed === true);
      setMemberCount(data.memberCount ?? Object.keys(v).length);

      // Restore my vote
      if (v[ME.id]) setMyVote(v[ME.id].status);

      // Check all-home
      const ids = Object.keys(v);
      if (ids.length > 0 && ids.every((id) => v[id].status === "yes") && !data.closed) {
        handleAutoClose();
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ── Vote ────────────────────────────────────────────────────────────────
  const castVote = async (optId) => {
    if (closed) return;
    setMyVote(optId);
    await set(ref(db, `polls/${POLL_ID}/votes/${ME.id}`), {
      name: ME.name,
      status: optId,
    });
  };

  // ── Auto-close ──────────────────────────────────────────────────────────
  const handleAutoClose = async () => {
    await set(ref(db, `polls/${POLL_ID}/closed`), true);
    setClosed(true);
    setCelebration(true);
    setTimeout(() => setCelebration(false), 3500);
  };

  // ── Progress bar ────────────────────────────────────────────────────────
  const total = Object.keys(votes).length;
  const homeCount = Object.values(votes).filter((v) => v.status === "yes").length;
  const progress = total > 0 ? (homeCount / total) * 100 : 0;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0f1318 0%, #141b1e 60%, #111519 100%)",
        fontFamily: "'DM Sans', sans-serif",
        color: "#fff",
        padding: "28px 20px 40px",
        maxWidth: 420,
        margin: "0 auto",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Fonts */}
      <link
        href="https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=DM+Sans:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      <style>{`
        @keyframes fall {
          0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(105vh) rotate(420deg); opacity: 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow {
          0%,100% { opacity: 0.6; }
          50%      { opacity: 1; }
        }
        .fadein { animation: fadeUp 0.45s ease both; }
        button:hover:not(:disabled) { filter: brightness(1.12); }
      `}</style>

      {/* Confetti */}
      {celebration &&
        confettiItems.current.map((c, i) => (
          <div
            key={i}
            style={{
              position: "fixed",
              top: -30,
              left: `${c.left}%`,
              fontSize: 22,
              animation: `fall ${c.dur}s ease-in ${c.delay}s forwards`,
              pointerEvents: "none",
              zIndex: 999,
            }}
          >
            {c.emoji}
          </div>
        ))}

      {/* Header */}
      <div className="fadein" style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 8, lineHeight: 1 }}>🏠</div>
        <h1
          style={{
            fontFamily: "'Lora', serif",
            fontSize: 24,
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.3px",
            color: "#f0ece4",
          }}
        >
          Are You Home Yet?
        </h1>
        <p style={{ color: "#556", fontSize: 13, margin: "8px 0 0" }}>
          Let your people know you're safe 🧡
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#444", marginTop: 60, animation: "glow 1.5s infinite" }}>
          Loading check-in...
        </div>
      ) : closed ? (
        /* ── CLOSED STATE ── */
        <div
          className="fadein"
          style={{
            background: "rgba(126,207,160,0.1)",
            border: "1.5px solid rgba(126,207,160,0.3)",
            borderRadius: 20,
            padding: 28,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 44 }}>🎉</div>
          <h2
            style={{
              fontFamily: "'Lora', serif",
              color: "#7ecfa0",
              margin: "12px 0 6px",
              fontSize: 20,
            }}
          >
            Everyone's home safe!
          </h2>
          <p style={{ color: "#4a8f63", fontSize: 14, margin: 0 }}>
            Check-in automatically closed. Sweet dreams! 💚
          </p>
        </div>
      ) : (
        <>
          {/* ── VOTE BUTTONS ── */}
          <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            <p style={{ color: "#556", fontSize: 13, margin: "0 0 6px", textAlign: "center" }}>
              {myVote ? "You responded — tap to change" : "How are you doing?"}
            </p>
            {OPTIONS.map((opt) => (
              <VoteButton
                key={opt.id}
                opt={opt}
                selected={myVote === opt.id}
                onClick={() => castVote(opt.id)}
                disabled={false}
              />
            ))}
          </div>

          {/* ── PROGRESS ── */}
          {total > 0 && (
            <div className="fadein" style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "#445",
                  marginBottom: 8,
                }}
              >
                <span>🏠 {homeCount} home</span>
                <span>{total} checked in</span>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 99,
                  height: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, #7ecfa0, #4ade80)",
                    height: "100%",
                    borderRadius: 99,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
              <p style={{ color: "#333", fontSize: 11, textAlign: "center", marginTop: 6 }}>
                Auto-closes when everyone is home ✨
              </p>
            </div>
          )}

          {/* ── MEMBER LIST ── */}
          {total > 0 && (
            <div
              className="fadein"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                padding: "4px 16px 8px",
              }}
            >
              <p
                style={{
                  color: "#334",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: "12px 0 4px",
                }}
              >
                Group Status
              </p>
              {Object.entries(votes).map(([uid, v]) => (
                <MemberRow key={uid} name={uid === String(ME.id) ? `${v.name} (you)` : v.name} status={v.status} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
