"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { API_URL } from "../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMessage("Enter a valid work email address.");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/password-reset/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const data = await response.json() as { message?: string };
      if (response.ok) return setSent(true);
      setMessage(data.message || "Password reset is temporarily unavailable.");
    } catch { setMessage("Password reset is temporarily unavailable."); } finally { setLoading(false); }
  }

  return <main className="forgot-password-page"><section className="brand-panel" aria-label="HRMS Cloud introduction"><div className="brand-logo-frame"><Image className="brand-logo" src="/logo-transparent.png" alt="HRMS Cloud" width={1600} height={533} priority /></div><div className="brand-copy"><h1>One platform. Complete workforce<br className="desktop-break" /> control.</h1><p>Manage organizations, people, and operations from one centralized platform.</p></div><footer className="brand-footer"><p>Authorized personnel only</p><p>© 2026 My Attendance HRMS. All rights reserved.</p></footer></section><section className="forgot-form-panel">{sent ? <div className="password-reset-feedback" role="status"><span className="password-reset-feedback-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 5.5L19.5 7" /></svg></span><h1>Check your email</h1><p>If an account exists for that email address, we&apos;ll send password reset instructions.</p><Link className="submit-button" href="/">Back to sign in</Link></div> : <form className="forgot-password-form" onSubmit={submit} noValidate><header><h1>Forgot your password?</h1><p>Enter your email address. If an account exists, we&apos;ll send password reset instructions.</p></header><label className="sr-only" htmlFor="reset-email">Email address</label><div className="forgot-input-wrap"><span aria-hidden="true" className="field-icon email-icon">@</span><input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="platform.admin@company.com" required /></div>{message && <p className="form-message" role="status">{message}</p>}<button className="submit-button" type="submit" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</button><Link className="back-to-sign-in" href="/">Back to sign in</Link></form>}</section></main>;
}
