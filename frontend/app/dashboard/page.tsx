"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import DashboardShell from "./dashboard-shell";

type Administrator = { id: string; email: string; role: "OWNER" | "ADMIN" };

export default function DashboardPage() {
  const router = useRouter();
  const [administrator, setAdministrator] = useState<Administrator | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    async function loadDashboard() {
      let token = sessionStorage.getItem("hrms_access_token");
      if (!token) {
        const refresh = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
        if (refresh.ok) {
          const data = await refresh.json() as { accessToken?: string };
          token = data.accessToken || null;
          if (token) sessionStorage.setItem("hrms_access_token", token);
        }
      }
      if (!token) return router.replace("/");
      const response = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
      if (!response.ok) {
        sessionStorage.removeItem("hrms_access_token");
        return router.replace("/");
      }
      const data = await response.json() as { user: Administrator };
      if (isActive) { setAdministrator(data.user); setIsLoading(false); }
    }
    loadDashboard().catch(() => { sessionStorage.removeItem("hrms_access_token"); router.replace("/"); });
    return () => { isActive = false; };
  }, [router]);

  async function logout() {
    const response = await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Sign-out request failed.");
    sessionStorage.removeItem("hrms_access_token");
    router.replace("/");
  }

  if (isLoading || !administrator) return <main className="dashboard-loading">Checking your session…</main>;
  return (
    <DashboardShell email={administrator.email} onSignOut={logout}>
      <section className="dashboard-content">
        <p className="dashboard-eyebrow">SUPER ADMIN CONSOLE</p>
        <h1>Welcome back</h1>
        <p>You are signed in as <strong>{administrator.email}</strong>.</p>
        <p className="dashboard-role">Role: {administrator.role}</p>
      </section>
    </DashboardShell>
  );
}
