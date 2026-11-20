"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useState } from "react";
import { API_URL } from "./lib/api";

const Icon = ({ children }: { children: ReactNode }) => <span aria-hidden="true" className="field-icon email-icon">{children}</span>;
const LockIcon = () => <svg aria-hidden="true" className="field-icon input-svg" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg>;
const EyeIcon = ({ hidden }: { hidden: boolean }) => <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" />{hidden && <path d="m4 4 16 16" />}</svg>;

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [remember, setRemember] = useState(true);
  const [visible, setVisible] = useState(false); const [loading, setLoading] = useState(false); const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMessage("Enter a valid work email address.");
    if (password.length < 8) return setMessage("Password must be at least 8 characters.");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim(), password, rememberMe: remember }) });
      const data = await response.json() as { message?: string; accessToken?: string; requiresTwoFactorSetup?: boolean; requiresTwoFactorVerification?: boolean };
      if (!response.ok) throw new Error(data.message || "Unable to sign in.");
      if (data.requiresTwoFactorSetup) return router.replace("/setup-2fa");
      if (data.requiresTwoFactorVerification) return router.replace("/verify-2fa");
      if (!data.accessToken) throw new Error(data.message || "Unable to sign in.");
      sessionStorage.setItem("hrms_access_token", data.accessToken); router.replace("/dashboard");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to sign in."); } finally { setLoading(false); }
  }

  return <main className="login-page"><section className="brand-panel" aria-label="HRMS Cloud introduction"><div className="brand-logo-frame"><Image className="brand-logo" src="/logo-transparent.png" alt="HRMS Cloud" width={1600} height={533} priority /></div><div className="brand-copy"><h1>One platform. Complete workforce<br className="desktop-break" /> control.</h1><p>Manage organizations, people, and operations from one centralized platform.</p></div><footer className="brand-footer"><p>Authorized personnel only</p><p>© 2026 My Attendance HRMS. All rights reserved.</p></footer></section>
    <section className="form-panel"><form className="login-form" onSubmit={submit} noValidate><header><h2>Welcome back</h2><p>Sign in to your platform account</p></header><label className="sr-only" htmlFor="email">Email address</label><div className="input-wrap"><Icon>@</Icon><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="platform.admin@company.com" autoComplete="email" required /></div><label className="sr-only" htmlFor="password">Password</label><div className="input-wrap"><LockIcon /><input id="password" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required /><button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}><EyeIcon hidden={visible} /></button></div><div className="options-row"><label className="remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Keep me signed in</label><Link className="forgot" href="/forgot-password">Forgot password?</Link></div>{message && <p className="form-message" role="status">{message}</p>}<button className="submit-button" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in to Console"}</button></form></section></main>;
}
