"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { API_URL } from "../lib/api";

const LockIcon = () => <svg aria-hidden="true" className="field-icon input-svg" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg>;
const EyeIcon = ({ hidden }: { hidden: boolean }) => <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" />{hidden && <path d="m4 4 16 16" />}</svg>;
function Requirement({ met, showErrors, children }: { met: boolean; showErrors: boolean; children: string }) {
  const failed = showErrors && !met;

  return (
    <li className={met ? "met" : failed ? "unmet" : undefined}>
      <span className="requirement-icon" aria-hidden="true">{met ? "✓" : failed ? "×" : ""}</span>
      {children}
      <span className="sr-only">{met ? " (met)" : " (not met)"}</span>
    </li>
  );
}

export default function ResetPasswordPage() {
  const [token] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || "");
  const [password, setPassword] = useState("");
  const [showPasswordErrors, setShowPasswordErrors] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const hasMinimumLength = password.length >= 12;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialCharacter = /[^A-Za-z0-9]/.test(password);
  const meetsRequirements = hasMinimumLength && hasUppercase && hasLowercase && hasNumber && hasSpecialCharacter;
  const passwordsMatch = Boolean(password) && password === confirmation;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!token) return setMessage("This password reset link is invalid or expired.");
    if (!meetsRequirements) return setMessage("Choose a password that meets all requirements.");
    if (!passwordsMatch) return setMessage("Passwords do not match.");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/password-reset/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      if (response.ok) {
        setPassword("");
        setConfirmation("");
        setResetComplete(true);
        return;
      }
      const data = await response.json() as { message?: string };
      setMessage(data.message || "This password reset link is invalid or expired.");
    } catch { setMessage("Unable to reset your password. Please request a new link."); } finally { setLoading(false); }
  }

  return <main className="reset-password-layout"><section className="brand-panel" aria-label="HRMS Cloud introduction"><div className="brand-logo-frame"><Image className="brand-logo" src="/logo-transparent.png" alt="HRMS Cloud" width={1600} height={533} priority /></div><div className="brand-copy"><h1>One platform. Complete workforce<br className="desktop-break" /> control.</h1><p>Manage organizations, people, and operations from one centralized platform.</p></div><footer className="brand-footer"><p>Authorized personnel only</p><p>© 2026 My Attendance HRMS. All rights reserved.</p></footer></section><section className="reset-form-panel">
      {resetComplete ? (
        <div className="password-reset-feedback password-reset-success">
          <span className="password-reset-feedback-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8.5" />
              <path d="m8.5 12 2.3 2.3 4.7-4.7" />
            </svg>
          </span>
          <h1 tabIndex={-1} ref={(heading) => heading?.focus()}>Password reset successful</h1>
          <p>Your password has been updated successfully. You can now sign in with your new password.</p>
          <Link className="submit-button" href="/">Back to sign in</Link>
        </div>
      ) : (
        <form className="reset-page-form" onSubmit={submit} noValidate><header><h1>Create a new password</h1><p>Enter and confirm your new password to secure your platform account.</p></header><label className="sr-only" htmlFor="new-password">New password</label><div className="reset-input-wrap"><LockIcon /><input id="new-password" aria-describedby="password-requirements" aria-invalid={showPasswordErrors && !meetsRequirements} onFocus={() => setShowPasswordErrors(false)} onBlur={() => setShowPasswordErrors(true)} type={visible ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter a new password" required /><button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}><EyeIcon hidden={visible} /></button></div><div id="password-requirements" className="password-requirements"><p>Password must contain</p><ul><Requirement showErrors={showPasswordErrors} met={hasMinimumLength}>At least 12 characters</Requirement><Requirement showErrors={showPasswordErrors} met={hasUppercase}>At least 1 uppercase letter (A–Z)</Requirement><Requirement showErrors={showPasswordErrors} met={hasLowercase}>At least 1 lowercase letter (a–z)</Requirement><Requirement showErrors={showPasswordErrors} met={hasNumber}>At least 1 number (0–9)</Requirement><Requirement showErrors={showPasswordErrors} met={hasSpecialCharacter}>At least 1 special character (!@#$…)</Requirement></ul></div><label className="sr-only" htmlFor="confirm-password">Confirm new password</label><div className="reset-input-wrap"><LockIcon /><input id="confirm-password" type={confirmationVisible ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirm new password" required /><button className="password-toggle" type="button" onClick={() => setConfirmationVisible(!confirmationVisible)} aria-label={confirmationVisible ? "Hide password" : "Show password"}><EyeIcon hidden={confirmationVisible} /></button></div>{message && <p className="form-message" role="status">{message}</p>}<button className="submit-button" type="submit" disabled={loading}>{loading ? "Resetting…" : "Reset password"}</button></form>
      )}
    </section></main>;
}
