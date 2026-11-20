"use client";

import { ClipboardEvent, FormEvent, KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { KeyIcon } from "../components/key-icon";
import { API_URL } from "../lib/api";

export default function VerifyTwoFactorPage() {
  const router = useRouter();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useLayoutEffect(() => {
    // Cached routes keep form state when they are hidden.
    return () => {
      setDigits(Array(6).fill(""));
      setRecoveryCode("");
      setUseRecovery(false);
      setMessage("");
    };
  }, []);

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus();
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    setDigits(Array.from({ length: 6 }, (_, index) => pasted[index] || ""));
    inputs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const code = digits.join("");
    if (useRecovery ? recoveryCode.trim().length < 8 : !/^\d{6}$/.test(code)) return setMessage(useRecovery ? "Enter a recovery code." : "Enter the six-digit code from your authenticator app.");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/verify-login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useRecovery ? { recoveryCode: recoveryCode.trim().toUpperCase() } : { code }),
      });
      const data = await response.json() as { message?: string; accessToken?: string };
      if (!response.ok || !data.accessToken) {
        if (response.status === 401 && /session has expired/i.test(data.message || "")) router.replace("/");
        throw new Error(useRecovery && response.status === 401 ? "Invalid or already-used recovery code." : data.message || "Unable to verify code.");
      }
      sessionStorage.setItem("hrms_access_token", data.accessToken);
      router.replace("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify code.");
    } finally {
      setLoading(false);
    }
  }

  function toggleRecovery() {
    setUseRecovery((current) => !current);
    setDigits(Array(6).fill(""));
    setRecoveryCode("");
    setMessage("");
  }

  return <main className="mfa-setup-page">
    <section className="mfa-brand-panel">
      <div className="brand-logo-frame mfa-logo-frame"><Image className="brand-logo" src="/logo-transparent.png" alt="HRMS Cloud" width={1600} height={533} priority /></div>
      <div className="mfa-brand-copy"><h1>One platform. Complete workforce<br />control.</h1><p>Manage organizations, people, and operations from one centralized platform.</p></div>
      <footer><p>◉ &nbsp; Authorized personnel only</p><p>© &nbsp; 2026 My Attendance HRMS. All rights reserved.</p></footer>
    </section>
    <section className="mfa-content-panel">
      <div className="mfa-verify-form">
        <h1>{useRecovery ? "Use a recovery code" : "Two-factor authentication"}</h1>
        <p>{useRecovery ? "Enter one of your saved recovery codes to access your platform account." : "Enter the 6-digit code from your authenticator app to continue."}</p>
        <form onSubmit={submit}>
          {useRecovery ? <div className="mfa-recovery-input-wrap"><KeyIcon /><input className="mfa-recovery-input" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} autoComplete="one-time-code" placeholder="A7K9-M2PX-Q4R8" /></div> : <div className="mfa-digit-inputs mfa-verify-digits">{digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} aria-label={`Verification digit ${index + 1}`} value={digit} onChange={(event) => setDigit(index, event.target.value)} onKeyDown={(event) => handleKeyDown(index, event)} onPaste={handlePaste} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} />)}</div>}
          <button className="mfa-submit" type="submit" disabled={loading}>{loading ? "Verifying…" : useRecovery ? "Verify recovery code" : "Verify and continue"}</button>
        </form>
        <p className="mfa-verify-link">{useRecovery ? <button type="button" onClick={toggleRecovery}>Use an authenticator code instead</button> : <>Can&apos;t access your authenticator? <button type="button" onClick={toggleRecovery}>Use a recovery code</button></>}</p>
        {message && <p className="mfa-message" role="status">{message}</p>}
      </div>
    </section>
  </main>;
}
