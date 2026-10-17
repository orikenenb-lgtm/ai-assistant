// Microphone recording with MediaRecorder (Chrome/Android: webm/opus, iPhone Safari: mp4/aac).

const MAX_SECONDS = 10 * 60;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of candidates) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

export function recordingSupported() {
  return !!(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

export class Recorder {
  constructor({ onTick, onLevel, onStop }) {
    this.onTick = onTick;
    this.onLevel = onLevel;
    this.onStop = onStop;
    this.chunks = [];
  }

  async start() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        throw new Error("אין הרשאה למיקרופון. אפשר אותה בהגדרות הדפדפן ונסה שוב.");
      }
      if (e?.name === "NotFoundError") throw new Error("לא נמצא מיקרופון במכשיר.");
      throw new Error("לא הצלחתי להפעיל את המיקרופון.");
    }
    this.stream = stream;
    const mime = pickMime();
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.mime = this.rec.mimeType || mime || "audio/webm";
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this._finish();
    this.rec.start(1000);
    this.t0 = performance.now();
    this.timer = setInterval(() => {
      const s = (performance.now() - this.t0) / 1000;
      this.onTick?.(s);
      if (s >= MAX_SECONDS) this.stop();
    }, 250);
    this._meter(stream);
  }

  _meter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        this.onLevel?.(peak);
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* the level meter is optional */ }
  }

  stop() {
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
  }

  cancel() {
    this.cancelled = true;
    this.stop();
    this._cleanup();
  }

  _cleanup() {
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.().catch(() => {});
  }

  _finish() {
    const seconds = (performance.now() - this.t0) / 1000;
    this._cleanup();
    if (this.cancelled) return;
    const type = this.mime.split(";")[0];
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    const stamp = new Date().toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }).replace(/[^\d]+/g, "-");
    const file = new File(this.chunks, `הקלטה-${stamp}.${ext}`, { type });
    this.onStop?.(file, seconds);
  }
}
