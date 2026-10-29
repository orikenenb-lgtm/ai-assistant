"use client";

import { Check, Keyboard, Mic, MicOff, Phone, PhoneOff, RotateCcw, Send, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { brand } from "@/config/site";
import { answers } from "@/lib/agent/knowledge";
import { leadFailedReply, respond } from "@/lib/agent/rules";
import { MAX_MESSAGES, initialDemoState, type AgentResponse, type ChatMessage, type DemoState } from "@/lib/agent/types";
import { formatMinutes } from "@/lib/format";
import { canRecognize, hebrewVoice, listenOnce, setVoiceCallActive, speak, stopSpeaking } from "@/components/demo/speech";

type Status = "idle" | "live" | "ended";
type Phase = "idle" | "speaking" | "listening" | "thinking";

const GREETING = answers.greeting;
const SUGGESTIONS = ["כמה זה עולה?", "איך זה עובד?", "מתחבר ליומן ולוואטסאפ?", "אני רוצה סוכן לעסק"];

async function askAgent(messages: ChatMessage[], state: DemoState): Promise<AgentResponse> {
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages.slice(-MAX_MESSAGES), state }),
    });
    if (res.ok) return (await res.json()) as AgentResponse;
    if (res.status === 429) {
      return { reply: "אני מקבלת המון שיחות כרגע. נסו שוב בעוד כמה דקות, או השאירו פרטים בטופס.", state, source: "rules" };
    }
  } catch {
    // offline or server error: fall through to the local engine
  }
  // Local fallback keeps the demo alive; it can't save leads, so it says so.
  const local = respond(messages, state);
  if (local.saveLead) return { reply: leadFailedReply, state: { ...local.state, leadSaved: false }, source: "rules" };
  return { reply: local.reply, state: local.state, end: local.end, source: "rules" };
}

function Waveform({ active, tone }: { active: boolean; tone: "agent" | "user" }) {
  const bars = [0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.75, 0.4, 0.85, 0.6, 0.95, 0.5];
  return (
    <div className="flex h-7 items-center gap-[3px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className={clsx(
            "w-[3px] rounded-full transition-all duration-300",
            tone === "agent" ? "bg-accent" : "bg-white",
            active ? "voice-bar" : "",
          )}
          style={{ height: `${active ? h * 100 : 18}%`, animationDelay: `${i * 90}ms`, opacity: active ? 1 : 0.35 }}
        />
      ))}
    </div>
  );
}

export function LiveDemo() {
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: GREETING }]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [leadSaved, setLeadSaved] = useState(false);

  const messagesRef = useRef(messages);
  const stateRef = useRef<DemoState>(initialDemoState);
  const statusRef = useRef<Status>("idle");
  const modeRef = useRef<"voice" | "text">("voice");
  const mutedRef = useRef(false);
  const busyRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const abortListenRef = useRef<(() => void) | null>(null);
  const silenceRef = useRef(0);
  /** Bumped on every start / end / unmount: async work from an older call must not touch the new one. */
  const callRef = useRef(0);
  /** Bumped whenever listening starts or is cancelled, so only one listen loop is ever alive. */
  const loopRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // listenLoop and send call each other; the ref breaks the declaration cycle.
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  const isCurrent = (call: number) => callRef.current === call && statusRef.current === "live";

  const pushMessage = useCallback((m: ChatMessage) => {
    messagesRef.current = [...messagesRef.current, m];
    setMessages(messagesRef.current);
  }, []);

  const stopListening = useCallback(() => {
    loopRef.current += 1;
    abortListenRef.current?.();
    abortListenRef.current = null;
  }, []);

  // Call timer
  useEffect(() => {
    if (status !== "live") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Keep the transcript scrolled to the latest line (inside the card only).
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, interim, phase]);

  // Pause the microphone when the tab is hidden; tear everything down on unmount.
  useEffect(() => {
    const onHide = () => {
      if (!document.hidden || statusRef.current !== "live" || modeRef.current !== "voice") return;
      stopListening();
      stopSpeaking();
      mutedRef.current = true;
      setMuted(true);
      if (!busyRef.current) setPhase("idle");
      setNotice("השיחה הושהתה כשעברתם לכרטיסייה אחרת. לחצו על המיקרופון כדי להמשיך.");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      callRef.current += 1;
      statusRef.current = "ended";
      stopListening();
      stopSpeaking();
      setVoiceCallActive(false);
    };
  }, [stopListening]);

  const endCall = useCallback(() => {
    callRef.current += 1;
    statusRef.current = "ended";
    busyRef.current = false;
    setStatus("ended");
    setPhase("idle");
    setInterim("");
    stopListening();
    stopSpeaking();
    setVoiceCallActive(false);
  }, [stopListening]);

  const say = useCallback(async (text: string, call: number) => {
    if (modeRef.current !== "voice" || !voiceRef.current || !isCurrent(call)) return;
    setPhase("speaking");
    await speak(text, voiceRef.current);
  }, []);

  const listenLoop = useCallback(async () => {
    const call = callRef.current;
    stopListening(); // supersede any loop that is still running
    const loop = loopRef.current;
    const mine = () => loopRef.current === loop && isCurrent(call);

    while (mine() && modeRef.current === "voice" && !mutedRef.current && !busyRef.current && !document.hidden) {
      setPhase("listening");
      setInterim("");
      const handle = listenOnce((t) => {
        if (mine()) setInterim(t);
      });
      abortListenRef.current = handle.abort;
      const outcome = await handle.promise;
      if (abortListenRef.current === handle.abort) abortListenRef.current = null;
      if (!mine()) return;
      setInterim("");

      if (outcome.kind === "text") {
        silenceRef.current = 0;
        await sendRef.current(outcome.text);
        return;
      }
      if (outcome.kind === "aborted") break;
      if (outcome.kind === "denied" || outcome.kind === "unavailable") {
        modeRef.current = "text";
        setMode("text");
        setVoiceCallActive(false);
        setPhase("idle");
        setNotice(
          outcome.kind === "denied"
            ? "לא קיבלנו גישה למיקרופון. אפשר להמשיך בכתיבה, או לאשר מיקרופון בדפדפן."
            : "זיהוי הדיבור לא זמין בדפדפן הזה. אפשר להמשיך בכתיבה.",
        );
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }
      silenceRef.current += 1;
      if (silenceRef.current >= 3) {
        setPhase("idle");
        setNotice("לא שמעתי כלום. לחצו על המיקרופון כדי לדבר שוב, או כתבו לי.");
        mutedRef.current = true;
        setMuted(true);
        return;
      }
    }
    if (mine() && !busyRef.current) setPhase("idle");
  }, [stopListening]);

  const send = useCallback(
    async (raw: string) => {
      const call = callRef.current;
      const text = raw.trim().slice(0, 500);
      if (!text || !isCurrent(call) || busyRef.current) return;
      busyRef.current = true;
      stopListening();
      stopSpeaking();
      setNotice(null);
      pushMessage({ role: "user", content: text });
      setPhase("thinking");

      const result = await askAgent(messagesRef.current, stateRef.current);
      // The call was ended or restarted meanwhile: drop the stale reply.
      if (!isCurrent(call)) return;
      busyRef.current = false;
      stateRef.current = result.state;
      if (result.lead === "saved") setLeadSaved(true);
      pushMessage({ role: "assistant", content: result.reply });

      await say(result.reply, call);
      if (!isCurrent(call)) return;
      if (result.end) {
        endCall();
        return;
      }
      setPhase("idle");
      if (modeRef.current === "voice" && !mutedRef.current && !document.hidden) void listenLoop();
    },
    [endCall, listenLoop, pushMessage, say, stopListening],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const start = useCallback(
    async (wanted: "voice" | "text") => {
      callRef.current += 1;
      const call = callRef.current;
      busyRef.current = false;
      stopListening();
      stopSpeaking();

      const voiceMode = wanted === "voice" && canRecognize();
      modeRef.current = voiceMode ? "voice" : "text";
      setMode(modeRef.current);
      setVoiceCallActive(voiceMode);
      statusRef.current = "live";
      setStatus("live");
      setPhase("idle");
      setSeconds(0);
      setLeadSaved(false);
      setNotice(wanted === "voice" && !voiceMode ? "זיהוי דיבור לא נתמך בדפדפן הזה (נסו Chrome או Edge). אפשר לכתוב לי כאן." : null);
      mutedRef.current = false;
      setMuted(false);
      silenceRef.current = 0;
      stateRef.current = initialDemoState;
      messagesRef.current = [{ role: "assistant", content: GREETING }];
      setMessages(messagesRef.current);

      if (voiceMode) {
        voiceRef.current = await hebrewVoice();
        if (!isCurrent(call)) return;
        if (!voiceRef.current) setNotice("אין קול עברי מותקן בדפדפן הזה, אז התשובות שלי יופיעו בכתב. אני עדיין שומעת אתכם.");
        await say(GREETING, call);
        if (isCurrent(call) && !busyRef.current && modeRef.current === "voice") void listenLoop();
      } else {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [listenLoop, say, stopListening],
  );

  // Other components (header CTA, final CTA) can start the demo.
  useEffect(() => {
    const onStart = () => {
      if (statusRef.current !== "live") void start("voice");
    };
    window.addEventListener("demo:start", onStart);
    return () => window.removeEventListener("demo:start", onStart);
  }, [start]);

  const toggleMute = () => {
    if (mode !== "voice") return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopListening();
      if (!busyRef.current) setPhase("idle");
    } else {
      silenceRef.current = 0;
      setNotice(null);
      stopSpeaking();
      if (!busyRef.current) void listenLoop();
    }
  };

  const switchToText = () => {
    stopListening();
    stopSpeaking();
    modeRef.current = "text";
    setMode("text");
    setVoiceCallActive(false);
    if (!busyRef.current) setPhase("idle");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const switchToVoice = () => {
    if (!canRecognize()) {
      setNotice("זיהוי דיבור לא נתמך בדפדפן הזה. נסו Chrome, Edge או Safari.");
      return;
    }
    const call = callRef.current;
    modeRef.current = "voice";
    setMode("voice");
    setVoiceCallActive(true);
    mutedRef.current = false;
    setMuted(false);
    setNotice(null);
    void hebrewVoice().then((v) => {
      voiceRef.current = v;
      if (isCurrent(call) && !busyRef.current && modeRef.current === "voice") void listenLoop();
    });
  };

  const live = status === "live";
  const statusLine =
    status === "live"
      ? phase === "listening"
        ? "מקשיבה…"
        : phase === "thinking"
          ? "חושבת…"
          : phase === "speaking"
            ? "מדברת"
            : mode === "text"
              ? "צ׳אט חי"
              : "בשיחה"
      : status === "ended"
        ? "השיחה הסתיימה"
        : "זמינה עכשיו";

  return (
    <div className="on-forest relative w-full rounded-[1.75rem] border border-white/12 bg-[#0b1711]/70 p-4 text-on-forest shadow-float backdrop-blur-xl sm:p-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="relative grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-[#6fae5f]">
          {live && phase === "speaking" ? (
            <span className="absolute inset-0 rounded-full bg-accent/40 animate-pulse-ring" aria-hidden="true" />
          ) : null}
          <span className="text-lg font-extrabold text-accent-ink">{brand.agentName.slice(0, 1)}</span>
          <span
            className={clsx(
              "absolute -bottom-0.5 -end-0.5 size-3.5 rounded-full border-2 border-[#0b1711]",
              status === "ended" ? "bg-white/40" : "bg-[#4ade80]",
            )}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{brand.agentName} · נציגת AI</p>
          <p className="flex items-center gap-2 text-sm text-on-forest-2" aria-live="polite">
            <span>{statusLine}</span>
            {live ? (
              <span className="tabular ltr rounded-full bg-white/10 px-2 py-0.5 text-xs text-on-forest">{formatMinutes(seconds)}</span>
            ) : null}
          </p>
        </div>
        {live ? (
          <Waveform active={phase === "speaking" || phase === "listening"} tone={phase === "listening" ? "user" : "agent"} />
        ) : (
          <span className="rounded-full bg-[#4ade80]/15 px-2.5 py-1 text-xs font-semibold text-[#86efac]">LIVE</span>
        )}
      </div>

      {/* Transcript */}
      <div
        ref={logRef}
        role="log"
        aria-label="תמלול השיחה"
        aria-live="polite"
        className={clsx(
          "no-scrollbar mt-4 space-y-2.5 overflow-y-auto overscroll-contain rounded-2xl bg-black/20 p-3 transition-[height] duration-500",
          status === "idle" ? "h-auto max-h-64" : "h-60 sm:h-64",
        )}
      >
        {messages.map((m, i) => (
          <div key={i} className={clsx("flex", m.role === "user" ? "justify-start" : "justify-end")}>
            <p
              className={clsx(
                "animate-in max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.94rem] leading-relaxed",
                m.role === "user" ? "rounded-ss-md bg-white text-[#132019]" : "rounded-se-md bg-forest-3 text-on-forest",
              )}
            >
              <span className="sr-only">{m.role === "user" ? "אתם: " : `${brand.agentName}: `}</span>
              {m.content}
            </p>
          </div>
        ))}
        {interim ? (
          <div className="flex justify-start">
            <p className="max-w-[85%] rounded-2xl rounded-ss-md bg-white/70 px-3.5 py-2 text-[0.94rem] italic text-[#132019]">{interim}</p>
          </div>
        ) : null}
        {phase === "thinking" ? (
          <div className="flex justify-end" aria-label="הסוכנת מקלידה">
            <span className="flex gap-1 rounded-2xl rounded-se-md bg-forest-3 px-4 py-3">
              {[0, 1, 2].map((d) => (
                <span key={d} className="size-1.5 animate-bounce rounded-full bg-on-forest-2" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </span>
          </div>
        ) : null}
      </div>

      {leadSaved ? (
        <p className="animate-in mt-3 flex items-center gap-2 rounded-xl bg-accent/15 px-3 py-2 text-sm text-accent">
          <Check className="size-4 shrink-0" /> הפרטים נשמרו. הצוות יחזור אליכם בקרוב.
        </p>
      ) : null}
      {notice ? <p className="mt-3 rounded-xl bg-white/8 px-3 py-2 text-sm text-on-forest-2">{notice}</p> : null}

      {/* Controls */}
      {status === "idle" ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-on-forest-2">שאלו אותה, למשל:</p>
          <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={async () => {
                  await start("text");
                  void sendRef.current(q);
                }}
                className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-on-forest transition hover:bg-white/12"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void start("voice")}
              className="group relative inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#22c55e] px-5 font-bold text-[#052e12] shadow-[0_10px_30px_-10px_rgba(34,197,94,0.8)] transition hover:bg-[#2fd36b]"
            >
              <span className="absolute inset-0 rounded-full bg-[#22c55e]/50 animate-pulse-ring" aria-hidden="true" />
              <Phone className="relative size-5" />
              <span className="relative">התחילו שיחה</span>
            </button>
            <button
              type="button"
              onClick={() => void start("text")}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-on-forest transition hover:bg-white/10"
            >
              <Keyboard className="size-4" />
              או כתבו לה
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-on-forest-2">
            <Volume2 className="size-3.5 shrink-0" />
            השיחה מתנהלת בדפדפן, בלי הרשמה. נבקש גישה למיקרופון רק כשתתחילו.
          </p>
        </div>
      ) : null}

      {live ? (
        <div className="mt-4 space-y-3">
          {messages.length <= 2 ? (
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-on-forest transition hover:bg-white/12"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const t = draft;
              setDraft("");
              void send(t);
            }}
          >
            <label htmlFor="demo-input" className="sr-only">
              הודעה לסוכנת
            </label>
            <input
              id="demo-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => {
                // Typing pauses the microphone so the two don't fight.
                if (modeRef.current === "voice" && !busyRef.current) {
                  stopListening();
                  setPhase("idle");
                }
              }}
              onBlur={() => {
                if (modeRef.current === "voice" && !mutedRef.current && !busyRef.current && statusRef.current === "live" && !draft.trim()) {
                  void listenLoop();
                }
              }}
              maxLength={500}
              autoComplete="off"
              placeholder={mode === "voice" ? "אפשר גם לכתוב…" : "כתבו הודעה…"}
              className="h-11 min-w-0 flex-1 rounded-full border border-white/12 bg-white/8 px-4 text-[0.95rem] text-on-forest placeholder:text-on-forest-2/80 focus:border-accent/60 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="שליחה"
              disabled={!draft.trim() || phase === "thinking"}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:bg-accent-hover disabled:opacity-40"
            >
              <Send className="size-4 -scale-x-100" />
            </button>
          </form>
          <div className="flex items-center justify-between gap-2">
            {mode === "voice" ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-pressed={muted}
                  className={clsx(
                    "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition",
                    muted ? "bg-white text-[#132019]" : "bg-white/10 text-on-forest hover:bg-white/15",
                  )}
                >
                  {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  {muted ? "המיקרופון כבוי" : "מיקרופון פעיל"}
                </button>
                <button type="button" onClick={switchToText} className="text-sm text-on-forest-2 underline-offset-4 hover:underline">
                  מעבר לכתיבה
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={switchToVoice}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-on-forest transition hover:bg-white/15"
              >
                <Mic className="size-4" /> מעבר לדיבור
              </button>
            )}
            <button
              type="button"
              onClick={endCall}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#ef4444] px-4 text-sm font-bold text-white transition hover:bg-[#f05252]"
            >
              <PhoneOff className="size-4" /> סיום
            </button>
          </div>
        </div>
      ) : null}

      {status === "ended" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="flex-1 text-sm text-on-forest-2">תודה שדיברתם איתי! רוצים סוכן כזה לעסק שלכם?</p>
          <button
            type="button"
            onClick={() => void start(mode)}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold transition hover:bg-white/10"
          >
            <RotateCcw className="size-4" /> שיחה חדשה
          </button>
          <a href="#contact" className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-bold text-accent-ink hover:bg-accent-hover">
            להשאיר פרטים
          </a>
        </div>
      ) : null}
    </div>
  );
}
