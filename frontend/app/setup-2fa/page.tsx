"use client";

import { ClipboardEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyIcon } from "../components/key-icon";
import { API_URL } from "../lib/api";

type SetupData = { enrollmentId: string; qrCodeDataUrl: string; manualSetupKey: string };
const COPY_FEEDBACK_MS = 4000;
const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
const CopyIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="11" rx="1.5" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></svg>;
const DownloadIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>;
const AlertIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3.8 19a1.4 1.4 0 0 0 1.2 2h14a1.4 1.4 0 0 0 1.2-2L12 4Z" /><path d="M12 9v5m0 3h.01" /></svg>;

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);

  const focused = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.cssText = "position: fixed; inset: 0 auto auto 0; opacity: 0;";
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable.");
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}

export default function SetupTwoFactorPage() {
  const router = useRouter();
  const requested = useRef(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recoveryCopyTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [message, setMessage] = useState("");
  const [setupAction, setSetupAction] = useState<"refresh" | "sign-in" | "retry-code" | "scan" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);
  const [manualKeyCopied, setManualKeyCopied] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCopyStatus, setRecoveryCopyStatus] = useState<"copied" | "failed" | null>(null);
  const [saved, setSaved] = useState(false);

  const loadSetup = useCallback(async (refresh = false) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/setup`, { method: "POST", credentials: "include" });
      const data = await response.json() as SetupData & { message?: string };
      if (!response.ok) {
        setSetupAction(response.status === 401 ? "sign-in" : "refresh");
        setMessage(data.message || "Unable to start setup.");
        return;
      }
      setSetup(data);
      setSetupAction(refresh ? "scan" : null);
      if (refresh) setMessage("Setup refreshed. Scan the QR code shown above and enter a fresh code from that Authenticator entry.");
    } catch {
      setSetupAction("refresh");
      setMessage("Unable to start setup. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void loadSetup();
  }, [loadSetup]);

  useEffect(() => () => {
    clearTimeout(copyTimeout.current);
    clearTimeout(recoveryCopyTimeout.current);
  }, []);

  function refreshSetup() {
    setLoading(true);
    setMessage("");
    void loadSetup(true);
  }

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    setDigits(Array.from({ length: 6 }, (_, index) => pasted[index] || ""));
    inputs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function copyManualKey(value: string) {
    const copyError = "Unable to copy to the clipboard. Select the text to copy it manually.";
    try {
      await copyText(value);
      setMessage((current) => current === copyError ? "" : current);
      showManualKeyCopied();
    } catch {
      setMessage(copyError);
    }
  }

  function showManualKeyCopied() {
    clearTimeout(copyTimeout.current);
    setManualKeyCopied(true);
    copyTimeout.current = setTimeout(() => setManualKeyCopied(false), COPY_FEEDBACK_MS);
  }

  async function copyRecoveryCodes(text: string) {
    try {
      await copyText(text);
      clearTimeout(recoveryCopyTimeout.current);
      setRecoveryCopyStatus("copied");
      recoveryCopyTimeout.current = setTimeout(() => setRecoveryCopyStatus(null), COPY_FEEDBACK_MS);
    } catch {
      clearTimeout(recoveryCopyTimeout.current);
      setRecoveryCopyStatus("failed");
    }
  }

  function downloadRecoveryCodes(text: string) {
    const file = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hrms-recovery-codes.txt";
    link.hidden = true;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSetupAction(null);
    const code = digits.join("");
    if (!/^\d{6}$/.test(code)) return setMessage("Enter the six-digit code from your authenticator app.");
    if (!setup) return setMessage("Your setup session has expired. Sign in again.");
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/verify-setup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, enrollmentId: setup.enrollmentId }),
      });
      const data = await response.json() as { code?: string; message?: string; accessToken?: string; recoveryCodes?: string[] };
      if (response.status === 409 || data.code === "SETUP_EXPIRED") {
        setSetup(null);
        setDigits(Array(6).fill(""));
        setShowManualKey(false);
        clearTimeout(copyTimeout.current);
        setManualKeyCopied(false);
        setSetupAction(response.status === 409 ? "refresh" : "sign-in");
        setMessage(data.message || "Your setup session has expired.");
        return;
      }
      if (data.code === "INVALID_AUTHENTICATOR_CODE") {
        setDigits(Array(6).fill(""));
        setSetupAction("retry-code");
        inputs.current[0]?.focus();
      }
      if (!response.ok || !data.accessToken || !data.recoveryCodes) throw new Error(data.message || "Unable to enable two-factor authentication.");
      sessionStorage.setItem("hrms_access_token", data.accessToken);
      setRecoveryCodes(data.recoveryCodes);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to enable two-factor authentication.");
    } finally {
      setSaving(false);
    }
  }

  if (recoveryCodes) {
    const recoveryText = recoveryCodes.join("\n");
    return <main className="mfa-setup-page">
    <section className="mfa-brand-panel">
      <div className="brand-logo-frame mfa-logo-frame"><Image className="brand-logo" src="/logo-transparent.png" alt="HRMS Cloud" width={1600} height={533} priority /></div>
      <div className="mfa-brand-copy"><h1>One platform. Complete workforce<br />control.</h1><p>Manage organizations, people, and operations from one centralized platform.</p></div>
      <footer><p>◉ &nbsp; Authorized personnel only</p><p>© &nbsp; 2026 My Attendance HRMS. All rights reserved.</p></footer>
    </section>
    <section className="mfa-content-panel">
      <div className="mfa-recovery-form">
        <p className="mfa-enabled"><ShieldIcon /> Two-factor authentication enabled</p>
        <h1>Save your recovery codes</h1>
        <p className="mfa-recovery-intro">Store these codes somewhere safe. Each code can be used only once if you lose access to your authenticator app.</p>
        <section className="mfa-recovery-card">
          <div className="mfa-recovery-list">{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div>
          <div className="mfa-recovery-actions">
            <button type="button" onClick={() => copyRecoveryCodes(recoveryText)}>
              <CopyIcon /> {recoveryCopyStatus === "copied" ? "Copied" : "Copy codes"}
            </button>
            <button type="button" onClick={() => downloadRecoveryCodes(recoveryText)}><DownloadIcon /> Download</button>
          </div>
          <div className={recoveryCopyStatus === "failed" ? "mfa-recovery-copy-error" : "sr-only"} role="status">
            {recoveryCopyStatus === "copied" && "Recovery codes copied."}
            {recoveryCopyStatus === "failed" && "Unable to copy. Select Download to save your recovery codes."}
          </div>
        </section>
        <p className="mfa-recovery-warning"><AlertIcon /><span>These codes are shown only once. Keep them private and store them securely.</span></p>
        <label className="mfa-saved-checkbox"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> <span>I&apos;ve saved my recovery codes</span></label>
        <button className="mfa-submit" type="button" disabled={!saved} onClick={() => router.replace("/dashboard")}>Continue to Console</button>
      </div>
    </section>
  </main>;
  }

  return <main className="mfa-setup-page">
    <section className="mfa-brand-panel">
      <div className="brand-logo-frame mfa-logo-frame"><Image className="brand-logo" src="/logo-transparent.png" alt="HRMS Cloud" width={1600} height={533} priority /></div>
      <div className="mfa-brand-copy"><h1>One platform. Complete workforce<br />control.</h1><p>Manage organizations, people, and operations from one centralized platform.</p></div>
      <footer><p>◉ &nbsp; Authorized personnel only</p><p>© &nbsp; 2026 My Attendance HRMS. All rights reserved.</p></footer>
    </section>
    <section className="mfa-content-panel">
      <div className="mfa-setup-form">
        <header><h1>Set up two-factor authentication</h1><p>Secure your platform account by connecting an authenticator app.</p></header>
        <section className="mfa-qr-card">
          <h2>1. Scan the QR code</h2><p>Open your authenticator app and scan this code.</p>
          {loading && <p className="mfa-loading">Preparing secure setup…</p>}
          {setup && <><Image className="mfa-qr-code" src={setup.qrCodeDataUrl} alt="Authenticator enrollment QR code" width={124} height={124} unoptimized /><p className="mfa-manual-toggle">Can&apos;t scan? <button type="button" onClick={() => setShowManualKey((visible) => !visible)}>{showManualKey ? "Hide manual setup key" : "Enter setup key manually"}</button></p>
            {showManualKey && (
              <div className="mfa-manual-panel">
                <hr />
                <h3>Manual setup key</h3>
                <div className="mfa-manual-key">
                  <KeyIcon />
                  <input className="mfa-manual-key-value" aria-label="Manual setup key" value={setup.manualSetupKey} readOnly />
                  <button
                    type="button"
                    className={manualKeyCopied ? "copied" : undefined}
                    aria-label="Copy manual setup key"
                    onClick={() => copyManualKey(setup.manualSetupKey)}
                  >
                    {manualKeyCopied ? "Copied" : <CopyIcon />}
                  </button>
                  <span className="sr-only" role="status">{manualKeyCopied ? "Setup key copied to clipboard." : ""}</span>
                </div>
                <p>Keep this key private. Anyone with this key may be able to generate authentication codes.</p>
              </div>
            )}
          </>}
        </section>
        <form onSubmit={verify} className="mfa-code-form">
          <label>2. Enter verification code</label>
          <div className="mfa-digit-inputs">{digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} aria-label={`Verification digit ${index + 1}`} value={digit} onChange={(event) => setDigit(index, event.target.value)} onKeyDown={(event) => handleKeyDown(index, event)} onPaste={handlePaste} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} />)}</div>
          <button className="mfa-submit" disabled={saving || loading || !setup} type="submit">{saving ? "Verifying…" : "Verify and enable MFA"}</button>
        </form>
        {message && <p className={setupAction === "scan" ? undefined : "mfa-message"} role="status">{message}</p>}
        {setupAction === "retry-code" && <p className="mfa-message">Check that your phone uses automatic date and time, then try a newly generated code from the entry for this QR code.</p>}
        {setupAction === "refresh" && <button className="mfa-submit" type="button" disabled={loading} onClick={refreshSetup}>Refresh QR code</button>}
        {setupAction === "sign-in" && <Link className="mfa-verify-link" href="/">Back to sign in</Link>}
      </div>
    </section>
  </main>;
}
