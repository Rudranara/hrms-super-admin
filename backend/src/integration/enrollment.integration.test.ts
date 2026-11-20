import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "../generated/prisma/client";
import { decryptTotpSecret, decodeTotpEncryptionKey } from "../lib/totp-crypto";
import { createTotp } from "../lib/totp";

const prisma = new PrismaClient();
const port = 4017;
const baseUrl = `http://127.0.0.1:${port}`;
const email = `totp-integration-${process.pid}@example.invalid`;
const password = "IntegrationTestPassword!42";
let server: ChildProcess | undefined;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Integration API did not start.");
}

function cookieFrom(response: Response) {
  const value = response.headers.get("set-cookie");
  const match = value?.match(/hrms_2fa_challenge=[^;]+/);
  assert.ok(match, "The login response must set a pre-authentication cookie.");
  return match[0];
}

test.before(async () => {
  if (!process.env.TOTP_ENCRYPTION_KEY) throw new Error("TOTP_ENCRYPTION_KEY is required for integration tests.");
  await prisma.user.deleteMany({ where: { email } });
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: Role.OWNER } });
  server = spawn(process.execPath, ["dist/server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();
});

test.after(async () => {
  server?.kill();
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test("rejects an expired enrollment challenge", async () => {
  const expiredEmail = `totp-expired-${process.pid}@example.invalid`;
  await prisma.user.deleteMany({ where: { email: expiredEmail } });
  const user = await prisma.user.create({ data: { email: expiredEmail, passwordHash: await bcrypt.hash(password, 10), role: Role.OWNER } });
  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: expiredEmail, password }) });
    const cookie = cookieFrom(login);
    const challenge = await prisma.twoFactorChallenge.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.twoFactorChallenge.update({ where: { id: challenge.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const setup = await fetch(`${baseUrl}/api/auth/2fa/setup`, { method: "POST", headers: { cookie } });
    assert.equal(setup.status, 401);
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});

test("accepts a current TOTP generated from the exact encrypted pending secret", async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json() as { requiresTwoFactorSetup?: boolean }).requiresTwoFactorSetup, true);
  const cookie = cookieFrom(login);

  const setup = await fetch(`${baseUrl}/api/auth/2fa/setup`, { method: "POST", headers: { cookie } });
  assert.equal(setup.status, 200);
  const setupData = await setup.json() as { enrollmentId: string; manualSetupKey: string; qrCodeDataUrl: string };
  assert.match(setupData.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.match(setupData.enrollmentId, /^[a-f0-9]{64}$/);

  const stored = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, twoFactorPendingSecretEncrypted: true } });
  assert.ok(stored.twoFactorPendingSecretEncrypted);
  const key = decodeTotpEncryptionKey(process.env.TOTP_ENCRYPTION_KEY!);
  assert.equal(decryptTotpSecret(stored.twoFactorPendingSecretEncrypted, key), setupData.manualSetupKey);

  // A second login overwrites the browser's challenge cookie, but must not replace
  // the pending secret or let an older setup page verify against the new challenge.
  const secondLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const secondCookie = cookieFrom(secondLogin);
  const secondSetup = await fetch(`${baseUrl}/api/auth/2fa/setup`, { method: "POST", headers: { cookie: secondCookie } });
  assert.equal(secondSetup.status, 200);
  const secondSetupData = await secondSetup.json() as { enrollmentId: string; manualSetupKey: string };
  assert.notEqual(secondSetupData.enrollmentId, setupData.enrollmentId);
  assert.equal(secondSetupData.manualSetupKey, setupData.manualSetupKey);

  const code = createTotp(setupData.manualSetupKey, email).generate();
  const staleVerification = await fetch(`${baseUrl}/api/auth/2fa/verify-setup`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify({ code, enrollmentId: setupData.enrollmentId }) });
  assert.equal(staleVerification.status, 409);

  // A refreshed QR can have a new secret even while its sign-in challenge stays active.
  await prisma.user.update({ where: { id: stored.id }, data: { twoFactorPendingExpiresAt: new Date(Date.now() - 1_000) } });
  const expiredQr = await fetch(`${baseUrl}/api/auth/2fa/verify-setup`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify({ code, enrollmentId: secondSetupData.enrollmentId }) });
  assert.equal(expiredQr.status, 409);
  assert.equal((await expiredQr.json()).code, "SETUP_REPLACED");
  const refreshed = await fetch(`${baseUrl}/api/auth/2fa/setup`, { method: "POST", headers: { cookie: secondCookie } });
  assert.equal(refreshed.status, 200);
  const refreshedData = await refreshed.json() as { enrollmentId: string; manualSetupKey: string };
  assert.notEqual(refreshedData.enrollmentId, secondSetupData.enrollmentId);
  assert.notEqual(refreshedData.manualSetupKey, secondSetupData.manualSetupKey);
  const oldQr = await fetch(`${baseUrl}/api/auth/2fa/verify-setup`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify({ code, enrollmentId: secondSetupData.enrollmentId }) });
  assert.equal(oldQr.status, 409);
  assert.equal((await oldQr.json()).code, "SETUP_REPLACED");

  const refreshedCode = createTotp(refreshedData.manualSetupKey, email).generate();
  const verification = await fetch(`${baseUrl}/api/auth/2fa/verify-setup`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify({ code: refreshedCode, enrollmentId: refreshedData.enrollmentId }) });
  assert.equal(verification.status, 200);
  const enrollment = await verification.json() as { success?: boolean; recoveryCodes?: string[] };
  assert.equal(enrollment.success, true);
  assert.equal(enrollment.recoveryCodes?.length, 10);

  const enrolled = await prisma.user.findUniqueOrThrow({ where: { id: stored.id }, select: { twoFactorEnabled: true, twoFactorPendingSecretEncrypted: true } });
  assert.equal(enrolled.twoFactorEnabled, true);
  assert.equal(enrolled.twoFactorPendingSecretEncrypted, null);
  const challenge = await prisma.twoFactorChallenge.findFirstOrThrow({ where: { userId: stored.id, consumedAt: { not: null } } });
  assert.ok(challenge.consumedAt);

  const authenticatorLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const authenticatorCookie = cookieFrom(authenticatorLogin);
  const authenticatorCode = createTotp(refreshedData.manualSetupKey, email).generate();
  const authenticatorVerification = await fetch(`${baseUrl}/api/auth/2fa/verify-login`, { method: "POST", headers: { cookie: authenticatorCookie, "content-type": "application/json" }, body: JSON.stringify({ code: authenticatorCode }) });
  assert.equal(authenticatorVerification.status, 200);

  const recoveryCode = enrollment.recoveryCodes![0];
  const recoveryLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const recoveryCookie = cookieFrom(recoveryLogin);
  const recoveryVerification = await fetch(`${baseUrl}/api/auth/2fa/verify-login`, { method: "POST", headers: { cookie: recoveryCookie, "content-type": "application/json" }, body: JSON.stringify({ recoveryCode: `  ${recoveryCode.toLowerCase()}  ` }) });
  assert.equal(recoveryVerification.status, 200);

  const reusedLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const reusedVerification = await fetch(`${baseUrl}/api/auth/2fa/verify-login`, { method: "POST", headers: { cookie: cookieFrom(reusedLogin), "content-type": "application/json" }, body: JSON.stringify({ recoveryCode }) });
  assert.equal(reusedVerification.status, 401);

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const invalidVerification = await fetch(`${baseUrl}/api/auth/2fa/verify-login`, { method: "POST", headers: { cookie: cookieFrom(invalidLogin), "content-type": "application/json" }, body: JSON.stringify({ recoveryCode: "NOTA-VALID-RECOVERY-CODE" }) });
  assert.equal(invalidVerification.status, 401);
});
