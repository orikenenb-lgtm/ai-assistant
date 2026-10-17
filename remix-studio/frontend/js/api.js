// Thin API client. Every error carries a Hebrew message for the UI.

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const NETWORK_ERROR = "אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.";

async function parse(res) {
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = body?.error_he || (res.status === 413 ? "הקובץ גדול מדי." : "משהו השתבש. נסה שוב.");
    if (res.status === 401) window.dispatchEvent(new CustomEvent("auth-required"));
    throw new ApiError(msg, res.status);
  }
  return body;
}

export async function request(method, url, data) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(NETWORK_ERROR, 0);
  }
  return parse(res);
}

export const api = {
  session: () => request("GET", "/api/session"),
  login: (password) => request("POST", "/api/login", { password }),
  logout: () => request("POST", "/api/logout"),
  presets: () => request("GET", "/api/presets"),
  job: (id) => request("GET", `/api/jobs/${encodeURIComponent(id)}`),
  jobs: () => request("GET", "/api/jobs"),
  remove: (id) => request("DELETE", `/api/jobs/${encodeURIComponent(id)}`),
};

/** POST /api/jobs as multipart via XHR so we get real upload progress. */
export function createJob(fields, file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v != null) form.append(k, v);
    if (file) form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jobs");
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      const body = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent("auth-required"));
      reject(new ApiError(body.error_he || (xhr.status === 413 ? "הקובץ גדול מדי. המקסימום הוא 50MB." : "ההעלאה נכשלה. נסה שוב."), xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(NETWORK_ERROR, 0));
    xhr.ontimeout = () => reject(new ApiError("ההעלאה לקחה יותר מדי זמן. נסה שוב.", 0));
    xhr.timeout = 15 * 60 * 1000;
    xhr.send(form);
  });
}
