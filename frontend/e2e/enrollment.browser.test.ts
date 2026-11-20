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

test("browser sends the pre-authentication cookie and completes enrollment", async () => {
  const user = await createUser("valid");
  const { context, page } = await enrollPage(user.email);
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
