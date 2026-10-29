"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Line } from "@/content/industries";
import { hebrewVoice, isVoiceCallActive, speak, stopSpeaking } from "@/components/demo/speech";

/** Reading pace used when no Hebrew voice is available (ms per character). */
const MS_PER_CHAR = 55;
const GAP_MS = 450;

export function lineDurationMs(text: string): number {
  return Math.max(1400, text.length * MS_PER_CHAR);
}

export function conversationDurationSeconds(lines: Line[]): number {
  return Math.round(lines.reduce((sum, l) => sum + lineDurationMs(l.text) + GAP_MS, 0) / 1000);
}

/**
 * Plays a scripted conversation line by line. Uses a Hebrew TTS voice when the
 * browser has one (customer and agent get different pitch), otherwise reveals
 * lines at reading pace. Before playing, every line is visible (`visible` =
 * lines.length) so the content is readable without JavaScript or interaction.
 */
export function useConversationPlayer(lines: Line[]) {
  const [visible, setVisible] = useState(lines.length);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [withVoice, setWithVoice] = useState(false);
  const runId = useRef(0);
  /** True while this player owns the speech engine (so cleanup never silences a live call). */
  const speakingRef = useRef(false);

  const halt = useCallback(() => {
    runId.current += 1;
    if (speakingRef.current) {
      speakingRef.current = false;
      stopSpeaking();
    }
  }, []);

  const stop = useCallback(() => {
    halt();
    setPlaying(false);
  }, [halt]);

  const self = useRef({});

  useEffect(() => {
    // A live voice call, or another player, takes over the speech engine:
    // stop playing here (the whole transcript stays visible).
    const yieldEngine = () => {
      runId.current += 1;
      speakingRef.current = false;
      setPlaying(false);
      setVisible(lines.length);
    };
    const onPlayer = (e: Event) => {
      if ((e as CustomEvent).detail !== self.current) yieldEngine();
    };
    window.addEventListener("speech:call-started", yieldEngine);
    window.addEventListener("speech:player-started", onPlayer);
    return () => {
      window.removeEventListener("speech:call-started", yieldEngine);
      window.removeEventListener("speech:player-started", onPlayer);
      halt();
    };
  }, [halt, lines.length]);

  // Reset when the script changes (e.g. switching industry tabs).
  const [prevLines, setPrevLines] = useState(lines);
  if (prevLines !== lines) {
    setPrevLines(lines);
    setVisible(lines.length);
    setPlaying(false);
    setElapsed(0);
  }
  useEffect(() => halt, [halt, lines]);

  useEffect(() => {
    if (!playing) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, [playing]);

  const play = useCallback(async () => {
    const id = ++runId.current;
    window.dispatchEvent(new CustomEvent("speech:player-started", { detail: self.current }));
    setPlaying(true);
    setVisible(0);
    setElapsed(0);
    const voice = isVoiceCallActive() ? null : await hebrewVoice();
    if (runId.current !== id) return;
    speakingRef.current = Boolean(voice);
    setWithVoice(Boolean(voice));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (let i = 0; i < lines.length; i++) {
      if (runId.current !== id) return;
      setVisible(i + 1);
      if (voice) {
        await speakAs(lines[i], voice);
      } else {
        await wait(reduceMotion ? 300 : lineDurationMs(lines[i].text));
      }
      if (runId.current !== id) return;
      await wait(GAP_MS);
    }
    if (runId.current === id) {
      speakingRef.current = false;
      setPlaying(false);
    }
  }, [lines]);

  return { visible, playing, elapsed, withVoice, play, stop };
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function speakAs(line: Line, voice: SpeechSynthesisVoice) {
  // One voice for both sides; a higher pitch tells the customer apart.
  return speak(line.text, voice, { pitch: line.who === "customer" ? 1.25 : 1 });
}
