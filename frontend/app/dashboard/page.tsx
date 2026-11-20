"use client";

import { useEffect, useState } from "react";
import { accessTokenKey, type Administrator, loadAdministrator, signOutDashboard } from "./dashboard-session";
import DashboardShell from "./dashboard-shell";

export default function DashboardPage() {
  const [administrator, setAdministrator] = useState<Administrator | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [sessionCheck, setSessionCheck] = useState(0);

  useEffect(() => {
    let isActive = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function checkSession(retry = true) {
      try {
        const user = await loadAdministrator();
        if (!isActive) return;
        if (!user) {
          sessionStorage.removeItem(accessTokenKey);
          window.location.replace("/?session=expired");
          return;
        }
        setAdministrator(user);
        setSessionError(false);
      } catch {
        if (!isActive) return;
        if (retry) {
          retryTimer = setTimeout(() => { void checkSession(false); }, 750);
          return;
        }
        setSessionError(true);
      }
    }
    void checkSession();
    return () => {
      isActive = false;
      clearTimeout(retryTimer);
    };
  }, [sessionCheck]);

  async function logout() {
    await signOutDashboard();
    window.location.replace("/");
  }

  function retrySession() {
    setSessionError(false);
    setSessionCheck((current) => current + 1);
  }

  const connectionNotice = sessionError && (
    <div className="dashboard-session-error">
      <p role="status">Unable to connect to the dashboard. Please try again.</p>
      <button type="button" onClick={retrySession}>Try again</button>
    </div>
  );
  if (!administrator) return <main className="dashboard-loading">{connectionNotice || "Checking your session…"}</main>;
  return (
    <DashboardShell email={administrator.email} onSignOut={logout}>
      {connectionNotice}
      <section className="dashboard-content">
        <p className="dashboard-eyebrow">SUPER ADMIN CONSOLE</p>
        <h1>Welcome back</h1>
        <p>You are signed in as <strong>{administrator.email}</strong>.</p>
        <p className="dashboard-role">Role: {administrator.role}</p>
      </section>
    </DashboardShell>
  );
}
