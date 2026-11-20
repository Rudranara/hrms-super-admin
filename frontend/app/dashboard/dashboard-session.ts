import { API_URL } from "../lib/api";

export type Administrator = { id: string; email: string; role: "OWNER" | "ADMIN" };
export const accessTokenKey = "hrms_access_token";
const SESSION_REQUEST_TIMEOUT_MS = 7000;

let localSessionRequest: Promise<unknown> = Promise.resolve();

async function withSessionLock<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
  const run = () => {
    signal.throwIfAborted();
    return request();
  };
  if (navigator.locks) return await navigator.locks.request("hrms-auth-session", { signal }, run);
  const pending = localSessionRequest.then(run, run);
  localSessionRequest = pending;
  return pending;
}

function authenticationRejected(response: Response) {
  return response.status === 401 || response.status === 403;
}

async function refreshAccessToken(previousToken: string | null, signal: AbortSignal) {
  return withSessionLock(signal, async () => {
    // Another dashboard check in this tab may have already renewed the token.
    const savedToken = sessionStorage.getItem(accessTokenKey);
    if (savedToken && savedToken !== previousToken) return savedToken;

    const response = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include", signal });
    if (authenticationRejected(response)) return null;
    if (!response.ok) throw new Error("Session renewal failed.");

    const data = await response.json() as { accessToken?: string };
    if (!data.accessToken) throw new Error("Session renewal returned no access token.");
    sessionStorage.setItem(accessTokenKey, data.accessToken);
    return data.accessToken;
  });
}

function requestAdministrator(token: string, signal: AbortSignal) {
  return fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include", signal });
}

export async function loadAdministrator(): Promise<Administrator | null> {
  const signal = AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS);
  const savedToken = sessionStorage.getItem(accessTokenKey);
  let response = savedToken ? await requestAdministrator(savedToken, signal) : null;
  if (!response || response.status === 401) {
    const token = await refreshAccessToken(savedToken, signal);
    if (!token) return null;
    response = await requestAdministrator(token, signal);
  }

  if (authenticationRejected(response)) return null;
  if (!response.ok) throw new Error("Dashboard session check failed.");
  const data = await response.json() as { user?: Administrator };
  if (!data.user) throw new Error("Dashboard session check returned no administrator.");
  return data.user;
}

export async function signOutDashboard() {
  const signal = AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS);
  await withSessionLock(signal, async () => {
    const response = await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include", signal });
    if (!response.ok) throw new Error("Sign-out request failed.");
    sessionStorage.removeItem(accessTokenKey);
  });
}
