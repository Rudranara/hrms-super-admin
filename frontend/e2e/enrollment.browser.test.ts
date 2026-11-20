import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import dotenv from "../../backend/node_modules/dotenv";
import { PrismaClient, Role } from "../../backend/src/generated/prisma/client";
import { decryptTotpSecret, decodeTotpEncryptionKey } from "../../backend/src/lib/totp-crypto";
import { createTotp } from "../../backend/src/lib/totp";

const root = path.resolve(process.cwd(), "..");
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");
dotenv.config({ path: path.join(backendDir, ".env") });
const backendRequire = createRequire(path.join(backendDir, "package.json"));
const bcrypt = backendRequire("bcrypt") as { hash(value: string, rounds: number): Promise<string> };
const backendUrl = "http://localhost:4018";
const frontendUrl = "http://localhost:3018";
const prisma = new PrismaClient();
const password = "BrowserEnrollmentTest!42";
let backend: ChildProcess | undefined;
let frontend: ChildProcess | undefined;
let browser: Browser | undefined;

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function createUser(label: string) {
  const email = `browser-2fa-${label}-${process.pid}@example.invalid`;
  await prisma.user.deleteMany({ where: { email } });
  return prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: Role.OWNER } });
}

async function enrollPage(email: string) {
  const context = await browser!.newContext();
  const page = await context.newPage();
  await page.goto(frontendUrl);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in to Console" }).click();
  await page.waitForURL(`${frontendUrl}/setup-2fa`);
  await page.locator(".mfa-qr-code").waitFor();
  return { context, page };
}

async function enterSetupCode(page: Page, code: string) {
  for (let index = 0; index < code.length; index += 1) await page.locator(".mfa-digit-inputs input").nth(index).fill(code[index]);
}

test.before(async () => {
  if (!process.env.TOTP_ENCRYPTION_KEY) throw new Error("TOTP_ENCRYPTION_KEY is required for browser tests.");
  execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd run build"], { cwd: backendDir, stdio: "inherit" });
  execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd run build"], { cwd: frontendDir, env: { ...process.env, NEXT_PUBLIC_API_URL: backendUrl }, stdio: "inherit" });
  backend = spawn(process.execPath, ["dist/server.js"], { cwd: backendDir, env: { ...process.env, PORT: "4018", FRONTEND_URL: frontendUrl }, stdio: "ignore" });
  frontend = spawn(process.execPath, [path.join(frontendDir, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3018"], { cwd: frontendDir, env: { ...process.env, NEXT_PUBLIC_API_URL: backendUrl }, stdio: "ignore" });
  await Promise.all([waitFor(`${backendUrl}/api/health`), waitFor(frontendUrl)]);
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  frontend?.kill();
  backend?.kill();
  await prisma.user.deleteMany({ where: { email: { startsWith: "browser-2fa-" } } });
  await prisma.$disconnect();
  execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd run build"], { cwd: frontendDir, env: process.env, stdio: "inherit" });
});

test("login preserves input and waits for hydration before submitting", async () => {
  const context = await browser!.newContext();
  const page = await context.newPage();
  const emailAddress = "login-hydration@example.invalid";
  let releaseScripts = () => {};
  const scriptGate = new Promise<void>((resolve) => { releaseScripts = resolve; });
  let documentRequests = 0;
  let loginRequests = 0;

  try {
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests++;
    });
    await page.route("**/_next/static/**", async (route) => {
      if (route.request().resourceType() === "script") await scriptGate;
      await route.continue();
    });
    await page.route(`${backendUrl}/api/auth/login`, async (route) => {
      loginRequests++;
      assert.equal(route.request().method(), "POST");
      assert.deepEqual(route.request().postDataJSON(), { email: emailAddress, password, rememberMe: true });
      assert.equal(new URL(route.request().url()).search, "");
      await route.fulfill(loginRequests === 1
        ? { status: 401, json: { message: "Invalid email or password." } }
        : { json: { requiresTwoFactorVerification: true } });
    });

    await page.goto(frontendUrl, { waitUntil: "commit" });
    const emailField = page.getByLabel("Email address", { exact: true });
    const passwordField = page.getByLabel("Password", { exact: true });
    const submit = page.locator(".login-form button[type=submit]");
    await emailField.fill(emailAddress);
    await passwordField.fill(password);
    assert.equal(await submit.isDisabled(), true);
    await submit.click({ force: true });
    await passwordField.press("Enter");

    releaseScripts();
    await page.getByRole("button", { name: "Sign in to Console" }).waitFor();
    assert.equal(documentRequests, 1);
    assert.equal(loginRequests, 0);
    assert.equal(await emailField.inputValue(), emailAddress);
    assert.equal(await passwordField.inputValue(), password);

    await submit.click();
    await page.getByRole("status").getByText("Invalid email or password.").waitFor();
    assert.equal(await emailField.inputValue(), emailAddress);
    assert.equal(await passwordField.inputValue(), password);

    await submit.click();
    await page.waitForURL(`${frontendUrl}/verify-2fa`);
    assert.equal(loginRequests, 2);
    assert.equal(await passwordField.evaluateAll((fields) => fields.every((field) => (field as HTMLInputElement).value === "")), true);
  } finally {
    releaseScripts();
    await context.close();
  }
});

test("browser sends the pre-authentication cookie and completes enrollment", async () => {
  const user = await createUser("valid");
  let { context, page } = await enrollPage(user.email);
  const cookies = await context.cookies(`${backendUrl}/api/auth/2fa/verify-setup`);
  const challengeCookie = cookies.find((cookie) => cookie.name === "hrms_2fa_challenge");
  assert.equal(challengeCookie?.httpOnly, true);
  assert.equal(challengeCookie?.path, "/api/auth/2fa");
  assert.equal(challengeCookie?.sameSite, "Lax");

  const pending = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorPendingSecretEncrypted: true } });
  assert.ok(pending.twoFactorPendingSecretEncrypted);
  const secret = decryptTotpSecret(pending.twoFactorPendingSecretEncrypted, decodeTotpEncryptionKey(process.env.TOTP_ENCRYPTION_KEY!));
  const code = createTotp(secret, user.email).generate();
  await enterSetupCode(page, code);
  await page.getByRole("button", { name: "Verify and enable MFA" }).click();
  await page.getByRole("heading", { name: "Save your recovery codes" }).waitFor();

  const enrolled = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorEnabled: true, twoFactorPendingSecretEncrypted: true } });
  assert.equal(enrolled.twoFactorEnabled, true);
  assert.equal(enrolled.twoFactorPendingSecretEncrypted, null);
  const challenge = await prisma.twoFactorChallenge.findFirstOrThrow({ where: { userId: user.id } });
  assert.ok(challenge.consumedAt);

  await page.getByRole("checkbox", { name: "I've saved my recovery codes" }).check();
  await page.getByRole("button", { name: "Continue to Console" }).click();
  await page.waitForURL(`${frontendUrl}/dashboard`);
  await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();

  // Recreate a browser session using only cookies that survive closing it.
  const storage = await context.storageState();
  const persistentCookies = storage.cookies.filter((cookie) => cookie.expires > Date.now() / 1000);
  assert.ok(persistentCookies.some((cookie) => cookie.name === "hrms_refresh_token" && cookie.httpOnly));
  await context.close();
  context = await browser!.newContext({ storageState: { cookies: persistentCookies, origins: [] } });
  page = await context.newPage();
  const restoredSession = page.waitForResponse((response) => response.url() === `${backendUrl}/api/auth/refresh`);
  await page.goto(frontendUrl);
  await page.waitForURL(`${frontendUrl}/dashboard`);
  assert.equal((await restoredSession).status(), 200);
  await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();

  await page.evaluate(() => sessionStorage.setItem("hrms_access_token", "test-rejected-access-token"));
  const renewal = page.waitForResponse((response) => response.url() === `${backendUrl}/api/auth/refresh`);
  await page.reload();
  assert.equal((await renewal).status(), 200);
  await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  const renewedToken = await page.evaluate(() => sessionStorage.getItem("hrms_access_token"));
  assert.ok(renewedToken && renewedToken !== "test-rejected-access-token");

  await page.route(`${backendUrl}/api/auth/me`, (route) => route.fulfill({ status: 503 }));
  await page.reload();
  await page.getByRole("status").getByText("Unable to connect to the dashboard. Please try again.").waitFor();
  assert.equal(page.url(), `${frontendUrl}/dashboard`);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("hrms_access_token")), renewedToken);
  await page.unroute(`${backendUrl}/api/auth/me`);
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();

  async function openSignOut() {
    await page.getByText("Platform Admin", { exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  }
  const signOutDialog = page.getByRole("dialog", { name: "Sign out", exact: true });
  async function signOut() {
    await openSignOut();
    await signOutDialog.getByRole("button", { name: "Sign out", exact: true }).click();
  }
  await openSignOut();
  await signOutDialog.getByRole("button", { name: "Cancel" }).click();
  await signOutDialog.waitFor({ state: "hidden" });
  assert.equal(page.url(), `${frontendUrl}/dashboard`);
  await signOut();
  await page.waitForURL(`${frontendUrl}/`);
  await page.goto(frontendUrl);
  await page.getByRole("button", { name: "Sign in to Console" }).waitFor();
  assert.ok(!(await context.cookies(frontendUrl)).some((cookie) => cookie.name === "hrms_refresh_token"));

  async function openVerification() {
    await page.locator("#email").fill(user.email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Sign in to Console" }).click();
    await page.waitForURL(`${frontendUrl}/verify-2fa`);
    await page.getByRole("heading", { name: "Two-factor authentication", exact: true }).waitFor();
  }

  await openVerification();
  const loginCode = createTotp(secret, user.email).generate();
  await enterSetupCode(page, loginCode);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await signOut();
  await openVerification();
  const verificationDigits = page.locator(".mfa-verify-digits input");
  assert.deepEqual(await verificationDigits.evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value)), Array(6).fill(""));
  await context.close();
});

test("an invalid remembered session falls back to sign-in without a redirect loop", async () => {
  const context = await browser!.newContext();
  try {
    await context.addCookies([{ name: "hrms_refresh_token", value: "invalid-test-session", url: frontendUrl, httpOnly: true }]);
    const page = await context.newPage();
    const renewal = page.waitForResponse((response) => response.url() === `${backendUrl}/api/auth/refresh`);
    await page.goto(frontendUrl);
    assert.equal((await renewal).status(), 401);
    await page.waitForURL(`${frontendUrl}/?session=expired`);
    await page.getByRole("button", { name: "Sign in to Console" }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Sign in to Console" }).waitFor();
    assert.equal(page.url(), `${frontendUrl}/?session=expired`);
  } finally {
    await context.close();
  }
});

test("reopening the dashboard can recover from stalled session renewal", async () => {
  const context = await browser!.newContext();
  try {
    await context.addCookies([{ name: "hrms_refresh_token", value: "test-remembered-session", url: frontendUrl, httpOnly: true }]);
    const page = await context.newPage();
    const refreshUrl = `${backendUrl}/api/auth/refresh`;
    let stalledRequests = 0;
    await page.route(refreshUrl, () => { stalledRequests++; });

    await page.goto(frontendUrl);
    await page.waitForURL(`${frontendUrl}/dashboard`);
    await page.getByRole("status").getByText("Unable to connect to the dashboard. Please try again.").waitFor({ timeout: 20_000 });
    assert.equal(stalledRequests, 2);
    assert.equal(page.url(), `${frontendUrl}/dashboard`);

    await page.unroute(refreshUrl);
    await page.route(refreshUrl, (route) => route.fulfill({ json: { accessToken: "test-renewed-token" } }));
    await page.route(`${backendUrl}/api/auth/me`, (route) => route.fulfill({
      json: { user: { id: "test", email: "remembered@example.invalid", role: "OWNER" } },
    }));
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("browser rejects an invalid code without consuming the challenge", async () => {
  const user = await createUser("invalid");
  const { context, page } = await enrollPage(user.email);
  await enterSetupCode(page, "000000");
  await page.getByRole("button", { name: "Verify and enable MFA" }).click();
  await page.getByText("Invalid authenticator code.").waitFor();
  const challenge = await prisma.twoFactorChallenge.findFirstOrThrow({ where: { userId: user.id } });
  assert.equal(challenge.consumedAt, null);
  const notEnrolled = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorEnabled: true } });
  assert.equal(notEnrolled.twoFactorEnabled, false);
  await context.close();
});

test("browser rejects an older setup page after a newer login replaces its challenge", async () => {
  const user = await createUser("stale-tab");
  const { context, page: olderPage } = await enrollPage(user.email);
  const pending = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorPendingSecretEncrypted: true } });
  assert.ok(pending.twoFactorPendingSecretEncrypted);
  const code = createTotp(decryptTotpSecret(pending.twoFactorPendingSecretEncrypted, decodeTotpEncryptionKey(process.env.TOTP_ENCRYPTION_KEY!)), user.email).generate();

  const newerPage = await context.newPage();
  await newerPage.goto(frontendUrl);
  await newerPage.locator("#email").fill(user.email);
  await newerPage.locator("#password").fill(password);
  await newerPage.getByRole("button", { name: "Sign in to Console" }).click();
  await newerPage.waitForURL(`${frontendUrl}/setup-2fa`);
  await newerPage.locator(".mfa-qr-code").waitFor();

  await enterSetupCode(olderPage, code);
  await olderPage.getByRole("button", { name: "Verify and enable MFA" }).click();
  await olderPage.getByText("This setup session was replaced. Refresh the QR code to continue.").waitFor();
  assert.equal(await olderPage.locator(".mfa-qr-code").count(), 0);
  const notEnrolled = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorEnabled: true } });
  assert.equal(notEnrolled.twoFactorEnabled, false);
  await olderPage.getByRole("button", { name: "Refresh QR code" }).click();
  await olderPage.locator(".mfa-qr-code").waitFor();
  await enterSetupCode(olderPage, createTotp(decryptTotpSecret(pending.twoFactorPendingSecretEncrypted, decodeTotpEncryptionKey(process.env.TOTP_ENCRYPTION_KEY!)), user.email).generate());
  await olderPage.getByRole("button", { name: "Verify and enable MFA" }).click();
  await olderPage.getByRole("heading", { name: "Save your recovery codes" }).waitFor();
  await context.close();
});
