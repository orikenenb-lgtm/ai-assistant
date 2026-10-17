import { api, ApiError, createJob } from "./api.js";
import { Recorder, recordingSupported } from "./recorder.js";

const $ = (sel) => document.querySelector(sel);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 10 * 60;
const MODE_NAMES = { remix: "רמיקס", separate: "הפרדת שכבות", transcribe: "תמלול", convert: "אל תיגע" };
const STATUS_NAMES = { queued: "בתור", running: "בעיבוד", done: "מוכן", error: "שגיאה" };
const LS_ACTIVE = "rs.activeJob";

const state = {
  file: null,            // File chosen or recorded
  fileDuration: null,
  mode: "remix",
  preset: "trap",
  format: "mp3",
  presets: [],
  recorder: null,
  pollTimer: null,
  pollJobId: null,
  pollFailures: 0,
  job: null,
  againPreset: null,
  previewUrl: null,
  busy: false,
};

// ------------------------------------------------------------------ utils

function show(el, on = true) { if (el) el.hidden = !on; }
function setError(el, msg) { el.textContent = msg || ""; show(el, !!msg); }
function fmtTime(s) {
  if (!isFinite(s) || s == null) return "";
  s = Math.round(s);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function fmtSize(b) {
  if (b == null) return "";
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(t, false), 3200);
}
function busy(btn, on) {
  btn.disabled = on;
  btn.classList.toggle("busy", on);
  btn.setAttribute("aria-busy", on ? "true" : "false");
}
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
function icon(path) { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`; }
const ICON_DOWNLOAD = "M12 4v12m0 0-4-4m4 4 4-4M4 20h16";
const ICON_PLAY = "M7 4v16l13-8z";
const ICON_TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const ICON_CHECK = "M20 6 9 17l-5-5";

// ------------------------------------------------------------------ theme

function initTheme() {
  const saved = lsGet("rs.theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    lsSet("rs.theme", next);
  });
}

// ------------------------------------------------------------------ routing

const screens = ["login", "home", "job", "history"];
function showScreen(name) {
  for (const s of screens) show($(`#screen-${s}`), s === name);
  show($("#topbar"), name !== "login");
  $("#nav-history").setAttribute("aria-current", name === "history" ? "page" : "false");
  if (name !== "job") stopPolling();
  window.scrollTo({ top: 0 });
}

async function route() {
  const hash = location.hash || "#/";
  if (hash === "#/login") return showScreen("login");
  const m = hash.match(/^#\/job\/([0-9a-f]{32})$/);
  if (m) return openJob(m[1]);
  if (hash === "#/history") return openHistory();
  showScreen("home");
  if (!state.presets.length) loadPresets();
}

window.addEventListener("hashchange", route);
window.addEventListener("auth-required", () => {
  if (location.hash !== "#/login") {
    sessionStorage.setItem("rs.after", location.hash || "#/");
    location.hash = "#/login";
  }
});

// ------------------------------------------------------------------ login

function initLogin() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-btn");
    const pw = $("#password").value;
    setError($("#login-error"), "");
    if (!pw) return setError($("#login-error"), "הכנס סיסמה.");
    busy(btn, true);
    try {
      await api.login(pw);
      $("#password").value = "";
      const after = sessionStorage.getItem("rs.after") || "#/";
      sessionStorage.removeItem("rs.after");
      location.hash = after === "#/login" ? "#/" : after;
      if (location.hash === after) route();
    } catch (err) {
      setError($("#login-error"), err.message);
      $("#password").focus();
    } finally {
      busy(btn, false);
    }
  });
  $("#logout").addEventListener("click", async () => {
    try { await api.logout(); } catch { /* ignore */ }
    lsSet(LS_ACTIVE, null);
    location.hash = "#/login";
  });
}

// ------------------------------------------------------------------ home: source

function setFile(file, knownDuration = null) {
  setError($("#source-error"), "");
  if (!file) {
    state.file = null;
    state.fileDuration = null;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    $("#file-preview").removeAttribute("src");
    show($("#source-ready"), false);
    show($("#source-empty"), true);
    $("#file-input").value = "";
    updateGo();
    return;
  }
  if (file.size > MAX_BYTES) {
    setError($("#source-error"), "הקובץ גדול מדי. המקסימום הוא 50MB.");
    $("#file-input").value = "";
    return;
  }
  if (file.size === 0) {
    setError($("#source-error"), "הקובץ ריק.");
    return;
  }
  state.file = file;
  state.fileDuration = knownDuration;
  $("#file-name").textContent = file.name;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);
  const audio = $("#file-preview");
  audio.src = state.previewUrl;
  const info = () => {
    const parts = [fmtSize(file.size)];
    const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : state.fileDuration;
    if (d) {
      state.fileDuration = d;
      parts.unshift(fmtTime(d));
      if (d > MAX_SECONDS + 1) setError($("#source-error"), "הקובץ ארוך מ-10 דקות. קצר אותו ונסה שוב.");
    }
    $("#file-info").textContent = parts.join(" · ");
    updateGo();
  };
  audio.onloadedmetadata = info;
  audio.onerror = () => {
    // Some formats (e.g. .opus on iPhone) can't be previewed but are fine on the server.
    $("#file-info").textContent = `${fmtSize(file.size)} · אין תצוגה מקדימה בדפדפן הזה`;
  };
  info();
  show($("#source-empty"), false);
  show($("#recorder"), false);
  show($("#source-ready"), true);
  updateGo();
}

function initSource() {
  const input = $("#file-input");
  input.addEventListener("change", () => setFile(input.files[0] || null));
  $("#file-clear").addEventListener("click", () => setFile(null));

  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) setFile(f); });
  // Dropping a file anywhere else must not navigate away.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  const recBtn = $("#record-btn");
  if (!recordingSupported()) {
    recBtn.disabled = true;
    recBtn.title = "הדפדפן הזה לא תומך בהקלטה";
    recBtn.lastChild.textContent = " הקלטה לא נתמכת בדפדפן הזה";
  }
  recBtn.addEventListener("click", startRecording);
  $("#rec-stop").addEventListener("click", () => state.recorder?.stop());
  $("#rec-cancel").addEventListener("click", () => {
    state.recorder?.cancel();
    state.recorder = null;
    show($("#recorder"), false);
    show($("#source-empty"), true);
    updateGo();
  });
}

async function startRecording() {
  setError($("#source-error"), "");
  const canvas = $("#rec-meter");
  const ctx = canvas.getContext("2d");
  const levels = [];
  const rec = new Recorder({
    onTick: (s) => { $("#rec-time").textContent = fmtTime(s); },
    onLevel: (p) => {
      levels.push(p);
      if (levels.length > 50) levels.shift();
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
      levels.forEach((v, i) => {
        const bh = Math.max(2, v * h);
        ctx.fillRect(w - (i + 1) * 4, (h - bh) / 2, 2, bh);
      });
    },
    onStop: (file, seconds) => {
      state.recorder = null;
      show($("#recorder"), false);
      if (seconds < 0.7 || file.size < 500) {
        show($("#source-empty"), true);
        setError($("#source-error"), "ההקלטה קצרה מדי. נסה שוב.");
        return;
      }
      setFile(file, seconds);
    },
  });
  try {
    $("#rec-time").textContent = "00:00";
    await rec.start();
    state.recorder = rec;
    show($("#source-empty"), false);
    show($("#recorder"), true);
    $("#rec-stop").focus();
    updateGo();
  } catch (e) {
    setError($("#source-error"), e.message);
  }
}

// ------------------------------------------------------------------ home: options

function renderChips(container, selected, onPick) {
  container.innerHTML = "";
  for (const p of state.presets) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = p.label_he;
    b.setAttribute("aria-pressed", String(p.id === selected));
    b.addEventListener("click", () => {
      onPick(p.id);
      container.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    });
    container.appendChild(b);
  }
}

async function loadPresets() {
  try {
    state.presets = await api.presets();
    renderChips($("#presets"), state.preset, (id) => { state.preset = id; });
  } catch (e) {
    if (e.status !== 401) setError($("#go-error"), e.message);
  }
}

function radioGroup(container, attr, onPick) {
  const buttons = [...container.querySelectorAll("[role=radio]")];
  const pick = (b, focus) => {
    buttons.forEach((x) => { x.setAttribute("aria-checked", String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    if (focus) b.focus();
    onPick(b.dataset[attr]);
  };
  buttons.forEach((b, i) => {
    b.tabIndex = b.getAttribute("aria-checked") === "true" ? 0 : -1;
    b.addEventListener("click", () => pick(b));
    b.addEventListener("keydown", (e) => {
      // RTL: ArrowLeft moves forward.
      const delta = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 }[e.key];
      if (!delta) return;
      e.preventDefault();
      pick(buttons[(i + delta + buttons.length) % buttons.length], true);
    });
  });
  return (value) => { const b = buttons.find((x) => x.dataset[attr] === value); if (b) pick(b); };
}

function initOptions() {
  radioGroup($("#modes"), "mode", (m) => {
    state.mode = m;
    show($("#remix-options"), m === "remix");
    show($("#format-options"), m !== "transcribe");
  });
  radioGroup($("#formats"), "format", (f) => { state.format = f; });
  $("#go-btn").addEventListener("click", submit);
}

function updateGo() {
  const tooLong = state.fileDuration && state.fileDuration > MAX_SECONDS + 1;
  $("#go-btn").disabled = !state.file || !!state.recorder || state.busy || tooLong;
}

async function submit() {
  if (!state.file || state.busy) return;
  setError($("#go-error"), "");
  state.busy = true;
  const btn = $("#go-btn");
  busy(btn, true);
  // Show the job screen immediately with a live upload step.
  showUploading(state.file.name);
  try {
    const fields = {
      mode: state.mode,
      output_format: state.format,
      instruction: state.mode === "remix" ? $("#instruction").value.trim() : "",
      preset: state.mode === "remix" ? state.preset : "",
    };
    const { job_id } = await createJob(fields, state.file, (f) => setUploadProgress(f));
    lsSet(LS_ACTIVE, job_id);
    setFile(null);
    $("#instruction").value = "";
    location.hash = `#/job/${job_id}`;
  } catch (e) {
    location.hash = "#/";
    showScreen("home");
    setError($("#go-error"), e.message);
  } finally {
    state.busy = false;
    busy(btn, false);
    updateGo();
  }
}

// ------------------------------------------------------------------ job screen

function showUploading(name) {
  showScreen("job");
  $("#job-title").textContent = "מעלה…";
  $("#job-sub").textContent = name;
  setBadge("running");
  show($("#job-progress"));
  show($("#job-result"), false);
  show($("#job-error"), false);
  show($("#job-hint"), false);
  renderSteps([{ key: "upload", label_he: "מעלה", state: "active" }]);
  setUploadProgress(0);
}

function setUploadProgress(f) {
  const pct = Math.round(f * 100);
  $("#progress-bar").style.width = `${Math.max(2, pct * 0.15)}%`;
  $(".progress").setAttribute("aria-valuenow", String(Math.round(pct * 0.15)));
  const li = $("#steps li");
  if (li) li.querySelector(".label-text").textContent = pct < 100 ? `מעלה… ${pct}%` : "מעלה… מסיים";
}

function setBadge(status) {
  const b = $("#job-badge");
  b.className = `badge ${status}`;
  b.textContent = STATUS_NAMES[status] || "";
}

function renderSteps(steps) {
  const ol = $("#steps");
  ol.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = s.state;
    li.innerHTML = `<span class="dot">${s.state === "done" ? icon(ICON_CHECK) : ""}</span><span class="label-text"></span>`;
    li.querySelector(".label-text").textContent = s.label_he;
    if (s.state === "active") li.setAttribute("aria-current", "step");
    ol.appendChild(li);
  }
}

async function openJob(id) {
  showScreen("job");
  state.pollJobId = id;
  state.job = null;
  $("#job-title").textContent = "טוען…";
  $("#job-sub").textContent = "";
  $("#job-badge").textContent = "";
  show($("#job-progress"));
  show($("#job-hint"));
  show($("#job-result"), false);
  show($("#job-error"), false);
  show($("#again-panel"), false);
  renderSteps([]);
  $("#progress-bar").style.width = "0%";
  poll(id);
}

function stopPolling() {
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
  state.pollJobId = null;
  const a = $("#result-audio");
  if (a && !a.paused) a.pause();
}

async function poll(id) {
  if (state.pollJobId !== id) return;
  let job;
  try {
    job = await api.job(id);
    state.pollFailures = 0;
    show($("#net-status"), false);
  } catch (e) {
    if (e.status === 401) return;
    if (e.status === 404) {
      if (lsGet(LS_ACTIVE) === id) lsSet(LS_ACTIVE, null);
      showJobError("העיבוד לא נמצא — אולי נמחק.");
      return;
    }
    // Network trouble: retry with backoff (2s, 4s, 8s … max 30s).
    state.pollFailures += 1;
    const delay = Math.min(30000, 2000 * 2 ** (state.pollFailures - 1));
    const n = $("#net-status");
    n.textContent = `אין חיבור — מנסה שוב בעוד ${Math.round(delay / 1000)} שניות…`;
    show(n);
    state.pollTimer = setTimeout(() => poll(id), delay);
    return;
  }
  if (state.pollJobId !== id) return;
  renderJob(job);
  if (job.status === "queued" || job.status === "running") {
    state.pollTimer = setTimeout(() => poll(id), 2000);
  } else if (lsGet(LS_ACTIVE) === id) {
    lsSet(LS_ACTIVE, null);
  }
}

function showJobError(msg) {
  show($("#job-progress"), false);
  const box = $("#job-error");
  box.textContent = msg;
  show(box);
  $("#job-title").textContent = "לא הצליח";
  setBadge("error");
}

function renderJob(job) {
  state.job = job;
  $("#job-sub").textContent = `${MODE_NAMES[job.mode]} · ${job.input?.name || ""}`;
  setBadge(job.status);
  if (job.status === "error") return showJobError(job.error_he || "משהו השתבש.");
  if (job.status !== "done") {
    $("#job-title").textContent = job.status === "queued" ? "ממתין לתור…" : "מעבד…";
    renderSteps(job.steps);
    const pct = Math.max(3, job.progress || 0);
    $("#progress-bar").style.width = `${pct}%`;
    $(".progress").setAttribute("aria-valuenow", String(pct));
    return;
  }
  if (!$("#job-result").hidden && state.renderedJob === job.id) return;
  state.renderedJob = job.id;
  $("#job-title").textContent = "מוכן!";
  show($("#job-progress"), false);
  show($("#job-result"));
  renderResult(job);
}

function renderResult(job) {
  const res = job.result;
  const audioFiles = res.files.filter((f) => f.kind === "audio");
  const main = audioFiles[0];
  const player = $("#result-audio");
  show(player.parentElement, !!main);
  const abWrap = $("#ab");
  show(abWrap, !!main && job.mode !== "separate");
  if (main) {
    player.src = `${main.url}?inline=1`;
    abWrap.querySelector('[data-src="result"]').textContent = job.mode === "remix" ? "רמיקס" : job.mode === "convert" ? "אחרי" : "תוצאה";
    state.ab = { main, job };
    state.setAB("result", true);
  }
  const facts = $("#facts");
  facts.innerHTML = "";
  const addFact = (label, value) => {
    if (value == null || value === "") return;
    const s = document.createElement("span");
    s.className = "fact";
    s.innerHTML = `${label}: <b></b>`;
    s.querySelector("b").textContent = value;
    facts.appendChild(s);
  };
  addFact("BPM", res.bpm ? Math.round(res.bpm) : null);
  addFact("סולם", res.key);
  addFact("אורך", res.duration ? fmtTime(res.duration) : null);
  $("#notes").textContent = res.notes_he || "";

  show($("#transcript-box"), !!res.transcript);
  $("#transcript").textContent = res.transcript || "";

  const ul = $("#files");
  ul.innerHTML = "";
  for (const f of res.files) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="grow"><strong dir="auto"></strong><span class="muted small"></span></div>`;
    li.querySelector("strong").textContent = f.label_he;
    li.querySelector(".small").textContent = `${f.name} · ${fmtSize(f.size)}`;
    if (f.kind === "audio" && audioFiles.length > 1) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "iconbtn";
      play.setAttribute("aria-label", `נגן ${f.label_he}`);
      play.innerHTML = icon(ICON_PLAY);
      play.addEventListener("click", () => {
        player.src = `${f.url}?inline=1`;
        player.play().catch(() => {});
        show(abWrap, false);
      });
      li.appendChild(play);
    }
    const a = document.createElement("a");
    a.className = "btn btn-secondary btn-sm";
    a.href = f.url;
    a.setAttribute("download", f.name);
    a.innerHTML = `${icon(ICON_DOWNLOAD)}<span>הורד</span>`;
    a.setAttribute("aria-label", `הורד ${f.label_he}`);
    li.appendChild(a);
    ul.appendChild(li);
  }

  const shareBtn = $("#share-btn");
  show(shareBtn, !!navigator.share && !!main);
  shareBtn.onclick = () => share(main || res.files[0], job);
  show($("#again-btn"), job.mode === "remix");
  $("#again-btn").onclick = async () => {
    const panel = $("#again-panel");
    show(panel, panel.hidden);
    if (!panel.hidden) {
      if (!state.presets.length) await loadPresets();
      state.againPreset = job.preset || state.preset;
      renderChips($("#again-presets"), state.againPreset, (id) => { state.againPreset = id; });
      $("#again-instruction").value = job.instruction || "";
      $("#again-instruction").focus();
    }
  };
  $("#again-go").onclick = () => again(job);
  $("#copy-transcript").onclick = async () => {
    try {
      await navigator.clipboard.writeText(res.transcript || "");
      toast("התמלול הועתק");
    } catch {
      const r = document.createRange();
      r.selectNodeContents($("#transcript"));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast("סמנתי את הטקסט — העתק ידנית");
    }
  };
}

function initAB() {
  const set = radioGroup($("#ab"), "src", (src) => {
    if (state.abSilent || !state.ab) return;
    switchAB(src, state.ab.main, state.ab.job);
  });
  // Select without loading (used when a new result is rendered).
  state.setAB = (src, silent) => { state.abSilent = silent; set(src); state.abSilent = false; };
}

function switchAB(src, main, job) {
  const player = $("#result-audio");
  const wasPlaying = !player.paused;
  const t = player.currentTime || 0;
  const url = src === "original" ? job.input.url : `${main.url}?inline=1`;
  // Remix may be tempo-changed: map position proportionally between the two versions.
  const fromDur = player.duration;
  player.src = url;
  player.onloadedmetadata = () => {
    const ratio = isFinite(fromDur) && isFinite(player.duration) && fromDur > 0 ? player.duration / fromDur : 1;
    try { player.currentTime = Math.min(t * ratio, Math.max(0, player.duration - 0.1)); } catch { /* not seekable yet */ }
    if (wasPlaying) player.play().catch(() => {});
    player.onloadedmetadata = null;
  };
}

async function share(file, job) {
  try {
    const res = await fetch(file.url, { credentials: "same-origin" });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const f = new File([blob], file.name, { type: blob.type || "audio/mpeg" });
    if (navigator.canShare?.({ files: [f] })) {
      await navigator.share({ files: [f], title: file.name });
      return;
    }
  } catch (e) {
    if (e?.name === "AbortError") return;
  }
  try {
    await navigator.share({ title: "רמיקס סטודיו", text: job.input?.name || "", url: location.href });
  } catch (e) {
    if (e?.name !== "AbortError") toast("השיתוף לא הצליח");
  }
}

async function again(job) {
  const btn = $("#again-go");
  setError($("#again-error"), "");
  busy(btn, true);
  try {
    const fd = {
      mode: "remix", source_job_id: job.id, preset: state.againPreset || "",
      instruction: $("#again-instruction").value.trim(), output_format: job.output_format || "mp3",
    };
    const { job_id } = await createJob(fd, null);
    lsSet(LS_ACTIVE, job_id);
    location.hash = `#/job/${job_id}`;
  } catch (e) {
    setError($("#again-error"), e.message);
  } finally {
    busy(btn, false);
  }
}

// ------------------------------------------------------------------ history

async function openHistory() {
  showScreen("history");
  const ul = $("#history-list");
  ul.innerHTML = `<li class="muted">טוען…</li>`;
  show($("#history-empty"), false);
  let jobs = [];
  try {
    ({ jobs } = await api.jobs());
  } catch (e) {
    ul.innerHTML = "";
    if (e.status !== 401) { const li = document.createElement("li"); li.className = "error"; li.textContent = e.message; ul.appendChild(li); }
    return;
  }
  ul.innerHTML = "";
  show($("#history-empty"), !jobs.length);
  for (const j of jobs) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "grow";
    link.href = `#/job/${j.id}`;
    link.innerHTML = `<strong dir="auto"></strong><span class="muted small"></span>`;
    link.querySelector("strong").textContent = j.input?.name || "ללא שם";
    link.querySelector(".small").textContent = `${MODE_NAMES[j.mode]} · ${fmtDate(j.created)}`;
    li.appendChild(link);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = STATUS_NAMES[j.status];
    li.appendChild(tag);
    const first = j.result?.files?.[0];
    if (first) {
      const a = document.createElement("a");
      a.className = "iconbtn";
      a.href = first.url;
      a.setAttribute("download", first.name);
      a.setAttribute("aria-label", `הורד ${first.name}`);
      a.innerHTML = icon(ICON_DOWNLOAD);
      li.appendChild(a);
    }
    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconbtn btn-danger";
    del.setAttribute("aria-label", `מחק את ${j.input?.name || "העיבוד"}`);
    del.innerHTML = icon(ICON_TRASH);
    del.addEventListener("click", async () => {
      if (!confirm("למחוק את העיבוד והקבצים שלו?")) return;
      del.disabled = true;
      try {
        await api.remove(j.id);
        li.remove();
        if (!ul.children.length) show($("#history-empty"));
        toast("נמחק");
      } catch (e) {
        del.disabled = false;
        toast(e.message);
      }
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}

// ------------------------------------------------------------------ boot

async function boot() {
  initTheme();
  initLogin();
  initSource();
  initOptions();
  initAB();
  $("#history-refresh").addEventListener("click", openHistory);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  let authed = false;
  try {
    authed = (await api.session()).authenticated;
  } catch (e) {
    if (e instanceof ApiError) toast(e.message);
  }
  if (!authed) {
    if (location.hash && location.hash !== "#/login") sessionStorage.setItem("rs.after", location.hash);
    location.hash = "#/login";
    return route();
  }
  if (location.hash === "#/login") location.hash = "#/";
  // Came back mid-job? Resume it.
  const active = lsGet(LS_ACTIVE);
  if (active && (!location.hash || location.hash === "#/")) {
    location.hash = `#/job/${active}`;
    return;
  }
  route();
}

boot();
