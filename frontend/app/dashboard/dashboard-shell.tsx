"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import "./dashboard-shell.css";

const iconPaths = {
  overview: <><rect x="3" y="3" width="7" height="11" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="18" width="7" height="3" rx="1" /></>,
  activity: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m7 14 3-3 3 2 4-5" /></>,
  sales: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m0-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 4 5v2" /></>,
  tenants: <path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v16m0-12 5 2v10" />,
  catalog: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 20V12m9-5-9 5-9-5m4.5-2.5 9 5" /></>,
  billing: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M6 15h4" /></>,
  infrastructure: <><rect x="2" y="3" width="20" height="7" rx="2" /><rect x="2" y="14" width="20" height="7" rx="2" /><path d="M6 6.5h.01M6 17.5h.01" /></>,
  operations: <path d="M14 7a5 5 0 0 1 6-5l-3 3v3h3l3-3a5 5 0 0 1-6 6L7 21a2.1 2.1 0 0 1-3-3l10-10V7Z" />,
  analytics: <path d="M5 21v-8m7 8V3m7 18V8" />,
  access: <path d="m12 2 8 4v5c0 5-3 8-8 11-5-3-8-6-8-11V6l8-4Zm-3 10 2 2 4-4" />,
  settings: <><path d="m10 3-.6 2.3-2 .9-2.1-.8-2 3.4L5 10.4v2.2l-1.7 1.6 2 3.4 2.1-.8 2 .9L10 20h4l.6-2.3 2-.9 2.1.8 2-3.4-1.7-1.6v-2.2l1.7-1.6-2-3.4-2.1.8-2-.9L14 3z" /><circle cx="12" cy="11.5" r="2.8" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  next: <path d="m9 6 6 6-6 6" />,
  switcher: <path d="m8 9 4-4 4 4m-8 6 4 4 4-4" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  sparkles: <path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2ZM5 13v8m-4-4h8m11-5v6m-3-3h6" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 6-2 6-2 8h16c0-2-2-2-2-8Zm-8 12a2 2 0 0 0 4 0" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  signOut: <path d="M10 17l5-5-5-5m5 5H3m10-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />,
};

type IconName = keyof typeof iconPaths;

function Icon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

const overview = { label: "Overview", icon: "overview" } as const;
const sections: { label: string; icon: IconName; group?: boolean }[] = [
  { label: "Activity", icon: "activity" },
  { label: "Sales", icon: "sales", group: true },
  { label: "Tenants", icon: "tenants", group: true },
  { label: "Catalog", icon: "catalog", group: true },
  { label: "Billing", icon: "billing", group: true },
  { label: "Infrastructure", icon: "infrastructure", group: true },
  { label: "Operations", icon: "operations", group: true },
  { label: "Analytics", icon: "analytics", group: true },
  { label: "Access Control", icon: "access", group: true },
  { label: "Settings", icon: "settings", group: true },
];

export default function DashboardShell({ email, onSignOut, children }: { email: string; onSignOut: () => Promise<void>; children: ReactNode }) {
  const searchInput = useRef<HTMLInputElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const accountSummary = useRef<HTMLElement>(null);
  const signOutDialog = useRef<HTMLDialogElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const searchTerm = query.trim().toLowerCase();
  const showSearchResults = searchOpen && searchTerm.length > 0;
  const matchingSections = [overview, ...sections].filter(({ label }) => label.toLowerCase().includes(searchTerm));

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (signOutDialog.current?.open) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSidebarOpen(false);
        if (accountMenu.current?.open) accountMenu.current.open = false;
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function openSignOutDialog() {
    setSignOutFailed(false);
    if (accountMenu.current) accountMenu.current.open = false;
    signOutDialog.current?.showModal();
  }

  async function confirmSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await onSignOut();
      signOutDialog.current?.close();
      setSidebarOpen(false);
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-shell-header">
        <div className="dashboard-shell-brand">
          <button className="dashboard-shell-mobile-toggle" type="button" aria-label="Toggle workspace navigation" aria-controls="workspace-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu" /></button>
          <Link href="/dashboard" className="dashboard-shell-brand-link" onClick={() => setSidebarOpen(false)}>
            <Image className="dashboard-shell-logo" src="/logo-transparent.png" alt="My Attendance HRMS dashboard" width={1600} height={533} sizes="216px" />
          </Link>
        </div>
        <div className="dashboard-shell-toolbar">
          <nav className="dashboard-shell-breadcrumb" aria-label="Breadcrumb"><span>Workspace</span><Icon name="next" /><span aria-current="page">Overview</span></nav>
          <div className="dashboard-shell-controls">
            <div className="dashboard-shell-search" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
            }}>
              <div className="dashboard-shell-search-field">
                <Icon name="search" />
                <input ref={searchInput} type="search" aria-label="Search workspace" aria-controls={showSearchResults ? "workspace-search-results" : undefined} placeholder="Search..." value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} />
                <kbd>Ctrl + K</kbd>
              </div>
              {showSearchResults && (
                <ul className="dashboard-shell-search-results" id="workspace-search-results" aria-label="Workspace search results">
                  {matchingSections.length ? matchingSections.map(({ label, icon }) => (
                    <li key={label}>
                      {label === overview.label ? <Link href="/dashboard" onClick={() => { setSearchOpen(false); setQuery(""); }}><Icon name={icon} />{label}</Link> : <span><Icon name={icon} />{label}<small>Unavailable</small></span>}
                    </li>
                  )) : <li><span>No matching sections</span></li>}
                </ul>
              )}
            </div>
            <div className="dashboard-shell-tools">
              <button type="button" className="dashboard-shell-ai-button" disabled aria-label="Ask AI" title="Ask AI is unavailable"><Icon name="sparkles" /><span>Ask AI</span></button>
              <button type="button" className="dashboard-shell-notification-button" disabled aria-label="Notifications" title="Notifications are unavailable"><Icon name="bell" /></button>
            </div>
          </div>
        </div>
      </header>

      <aside className="dashboard-shell-sidebar" id="workspace-sidebar" data-open={sidebarOpen}>
        <nav className="dashboard-shell-navigation" aria-label="Workspace">
          <Link className="dashboard-shell-active" href="/dashboard" aria-current="page" onClick={() => setSidebarOpen(false)}><Icon name={overview.icon} /><span>{overview.label}</span></Link>
          {sections.map(({ label, icon, group }) => (
            <button key={label} type="button" disabled title={`${label} is unavailable`}>
              <Icon name={icon} /><span>{label}</span>{group && <span className="dashboard-shell-nav-chevron"><Icon name="chevron" /></span>}
            </button>
          ))}
        </nav>
        <details className="dashboard-shell-account" ref={accountMenu}>
          <summary ref={accountSummary}>
            <span className="dashboard-shell-avatar" aria-hidden="true">PA</span>
            <span className="dashboard-shell-account-text"><span>Platform Admin</span><span className="dashboard-shell-account-email">{email}</span></span>
            <Icon name="switcher" />
          </summary>
          <div className="dashboard-shell-account-menu">
            <button type="button" onClick={openSignOutDialog}><Icon name="signOut" />Sign out</button>
          </div>
        </details>
      </aside>

      <main className="dashboard-shell-content">{children}</main>

      <dialog
        className="dashboard-shell-sign-out-dialog"
        ref={signOutDialog}
        aria-labelledby="sign-out-title"
        aria-describedby="sign-out-description"
        onCancel={(event) => { if (signingOut) event.preventDefault(); }}
        onClose={() => accountSummary.current?.focus()}
      >
        <h2 id="sign-out-title">Sign out</h2>
        <p id="sign-out-description">Are you sure you want to sign out of this site?</p>
        {signOutFailed && <p className="dashboard-shell-sign-out-error" role="alert">Unable to sign out. Please try again.</p>}
        <div className="dashboard-shell-sign-out-actions">
          <button type="button" disabled={signingOut} onClick={() => signOutDialog.current?.close()}>Cancel</button>
          <button type="button" disabled={signingOut} onClick={confirmSignOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
        </div>
      </dialog>
    </div>
  );
}
