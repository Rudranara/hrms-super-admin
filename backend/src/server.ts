import "dotenv/config";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import jwt, { JwtPayload } from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import { PrismaClient, Role, TwoFactorChallengeType } from "./generated/prisma/client";
import { decryptTotpSecret, decodeTotpEncryptionKey, encryptTotpSecret } from "./lib/totp-crypto";
import { createProvisioningUri, generateTotpSecret, verifyTotp } from "./lib/totp";

const app = express(); const prisma = new PrismaClient(); const PORT = Number(process.env.PORT) || 4000;
const jwtSecret = process.env.JWT_SECRET; if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters."); const signingSecret = jwtSecret;
const encodedKey = process.env.TOTP_ENCRYPTION_KEY; if (!encodedKey) throw new Error("TOTP_ENCRYPTION_KEY must be configured.");
const encryptionKey = decodeTotpEncryptionKey(encodedKey);
const refreshDays = 30, challengeMinutes = 10, pendingMinutes = 15, passwordResetMinutes = 15, challengeCookie = "hrms_2fa_challenge";
const loginSchema = z.object({ email: z.string().trim().email().max(191), password: z.string().min(8).max(128), rememberMe: z.boolean().optional().default(false) });
const setupVerificationSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/), enrollmentId: z.string().regex(/^[a-f0-9]{64}$/) });
const verificationSchema = z.object({ code: z.string().trim().optional(), recoveryCode: z.string().trim().min(8).max(64).optional() }).refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), "Provide one verification method.");
const sensitiveSchema = z.object({ password: z.string().min(8).max(128), code: z.string().trim().optional(), recoveryCode: z.string().trim().min(8).max(64).optional() }).refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), "Provide one verification method.");
const passwordResetRequestSchema = z.object({ email: z.string().trim().email().max(191) });
const passwordResetConfirmationSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().min(12).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/) });
type AuthRequest = Request & { auth?: { userId: string; role: Role } };
app.use(helmet()); app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true })); app.use(express.json({ limit: "16kb" })); app.use(cookieParser());
const cookieOptions = (persistent: boolean) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", ...(persistent ? { maxAge: refreshDays * 86400000 } : {}) });
const challengeOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/auth/2fa", maxAge: challengeMinutes * 60000 };
const accessToken = (user: { id: string; role: Role }) => jwt.sign({ sub: user.id, role: user.role }, signingSecret, { expiresIn: "1h" });
const refreshToken = (id: string, rememberMe: boolean) => jwt.sign({ sid: id, rememberMe }, signingSecret, { expiresIn: `${refreshDays}d` });
const opaque = () => crypto.randomBytes(32).toString("base64url");
const tokenHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const enrollmentFingerprint = (challengeId: string, encryptedSecret: string) => crypto.createHmac("sha256", signingSecret).update(JSON.stringify(["enrollment", challengeId, encryptedSecret])).digest("hex");
const normalizeCode = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
const recoveryCodes = () => Array.from({ length: 10 }, () => `${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`);
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(name: string, limit: number, window: number) { return (req: Request, res: Response, next: NextFunction) => { const key = `${name}:${req.ip}`, now = Date.now(), previous = attempts.get(key); if (!previous || previous.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + window }); return next(); } if (previous.count >= limit) return res.status(429).json({ success: false, message: "Too many attempts. Please try again later." }); previous.count++; return next(); }; }
function passwordResetEmailRateLimit(req: Request, res: Response, next: NextFunction) { const suppliedEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "invalid"; const key = `password-reset-email:${tokenHash(suppliedEmail)}`, now = Date.now(), previous = attempts.get(key); if (!previous || previous.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 900000 }); return next(); } if (previous.count >= 3) return res.status(429).json({ success: false, message: "Too many attempts. Please try again later." }); previous.count++; return next(); }
async function makeSession(userId: string, rememberMe: boolean, userAgent?: string, db: Pick<PrismaClient, "session"> = prisma) { const session = await db.session.create({ data: { userId, expiresAt: new Date(Date.now() + refreshDays * 86400000), refreshTokenHash: "pending", userAgent: userAgent?.slice(0, 500) } }); const token = refreshToken(session.id, rememberMe); await db.session.update({ where: { id: session.id }, data: { refreshTokenHash: await bcrypt.hash(token, 12) } }); return token; }
function deny(res: Response) { return res.status(401).json({ success: false, message: "Authentication is required." }); }
async function authenticate(req: AuthRequest, res: Response, next: NextFunction) { const token = req.header("authorization")?.replace(/^Bearer\s+/i, ""); if (!token) return deny(res); try { const payload = jwt.verify(token, signingSecret) as JwtPayload; if (typeof payload.sub !== "string" || (payload.role !== Role.OWNER && payload.role !== Role.ADMIN)) return deny(res); const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true, twoFactorEnabled: true } }); if (!user?.isActive || !user.twoFactorEnabled) return deny(res); req.auth = { userId: payload.sub, role: payload.role }; return next(); } catch { return deny(res); } }
const authorize = (...roles: Role[]) => (req: AuthRequest, res: Response, next: NextFunction) => !req.auth || !roles.includes(req.auth.role) ? res.status(403).json({ success: false, message: "You do not have permission to access this resource." }) : next();
async function createChallenge(userId: string, type: TwoFactorChallengeType, rememberMe: boolean, res: Response) { const token = opaque(); await prisma.twoFactorChallenge.create({ data: { userId, type, rememberMe, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + challengeMinutes * 60000) } }); res.cookie(challengeCookie, token, challengeOptions); }
function getChallenge(req: Request, type: TwoFactorChallengeType) { const token = req.cookies[challengeCookie] as string | undefined; return token ? prisma.twoFactorChallenge.findFirst({ where: { tokenHash: tokenHash(token), type, consumedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } }) : Promise.resolve(null); }
async function consumeChallenge(id: string) { return (await prisma.twoFactorChallenge.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } })).count === 1; }
async function completeLogin(user: { id: string; email: string; role: Role }, rememberMe: boolean, req: Request, res: Response) { const refresh = await makeSession(user.id, rememberMe, req.get("user-agent")); res.clearCookie(challengeCookie, challengeOptions); res.cookie("hrms_refresh_token", refresh, cookieOptions(rememberMe)); return res.json({ success: true, accessToken: accessToken(user), user }); }
async function useRecoveryCode(userId: string, code: string) { for (const candidate of await prisma.twoFactorRecoveryCode.findMany({ where: { userId, consumedAt: null } })) if (await bcrypt.compare(normalizeCode(code), candidate.codeHash)) return (await prisma.twoFactorRecoveryCode.updateMany({ where: { id: candidate.id, consumedAt: null }, data: { consumedAt: new Date() } })).count === 1; return false; }
async function secondFactor(user: { id: string; email: string; twoFactorSecretEncrypted: string | null }, code?: string, recoveryCode?: string) { if (code && user.twoFactorSecretEncrypted) return verifyTotp(decryptTotpSecret(user.twoFactorSecretEncrypted, encryptionKey), user.email, code); return recoveryCode ? useRecoveryCode(user.id, recoveryCode) : false; }
function passwordResetUrl(token: string) { const frontendUrl = process.env.FRONTEND_URL; if (!frontendUrl) throw new Error("FRONTEND_URL must be configured for password reset."); const url = new URL("/reset-password", frontendUrl); url.searchParams.set("token", token); return url.toString(); }
async function isCompromisedPassword(password: string) { const hash = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase(), prefix = hash.slice(0, 5), suffix = hash.slice(5); const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error("Password safety service is unavailable."); const matches = (await response.text()).split(/\r?\n/); return matches.some((entry) => { const [candidate, count] = entry.split(":"); return candidate === suffix && Number(count) > 0; }); }
async function sendPasswordResetEmail(email: string, token: string) { const apiToken = process.env.MAILTRAP_API_TOKEN, from = process.env.MAIL_FROM; if (!apiToken || !from) throw new Error("Password reset email is not configured."); const resetUrl = passwordResetUrl(token); const response = await fetch("https://send.api.mailtrap.io/api/send", { method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: { email: from, name: "HRMS Cloud" }, to: [{ email }], subject: "Reset your HRMS Cloud password", text: `A password reset was requested for your HRMS Cloud account. Use this one-time link within ${passwordResetMinutes} minutes: ${resetUrl}`, html: `<p>A password reset was requested for your HRMS Cloud account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in ${passwordResetMinutes} minutes. If you did not request this, you can ignore this email.</p>`, category: "password-reset" }), signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error(`Password reset email provider rejected the request (${response.status}).`); }


app.get("/api/health", async (_req, res) => { try { await prisma.$queryRaw`SELECT 1`; res.json({ success: true, message: "HRMS Super Admin API is running", database: "connected" }); } catch { res.status(503).json({ success: false, message: "Database is unavailable" }); } });
app.post("/api/auth/password-reset/request", rateLimit("password-reset-request", 5, 900000), passwordResetEmailRateLimit, async (req, res, next) => { try { const input = passwordResetRequestSchema.parse(req.body), email = input.email.toLowerCase(), success = { success: true, message: "If an active account exists for that email address, password reset instructions have been sent." }; if (!process.env.MAILTRAP_API_TOKEN || !process.env.MAIL_FROM || !process.env.FRONTEND_URL) return res.status(503).json({ success: false, message: "Password reset is temporarily unavailable." }); const user = await prisma.user.findFirst({ where: { email, isActive: true }, select: { id: true, email: true } }); if (!user) return res.json(success); const token = opaque(), tokenHashValue = tokenHash(token); const reset = await prisma.$transaction(async (tx) => { await tx.passwordResetToken.deleteMany({ where: { userId: user.id, consumedAt: null } }); return tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: tokenHashValue, expiresAt: new Date(Date.now() + passwordResetMinutes * 60000) } }); }); try { await sendPasswordResetEmail(user.email, token); } catch { await prisma.passwordResetToken.deleteMany({ where: { id: reset.id, consumedAt: null } }); return res.status(503).json({ success: false, message: "Password reset is temporarily unavailable." }); } return res.json(success); } catch (error) { next(error); } });
app.post("/api/auth/password-reset/confirm", rateLimit("password-reset-confirm", 8, 900000), async (req, res, next) => { try { const input = passwordResetConfirmationSchema.parse(req.body), now = new Date(), reset = await prisma.passwordResetToken.findFirst({ where: { tokenHash: tokenHash(input.token), consumedAt: null, expiresAt: { gt: now }, user: { isActive: true } }, include: { user: { select: { id: true } } } }); if (!reset) return res.status(400).json({ success: false, message: "This password reset link is invalid or expired." }); let compromised: boolean; try { compromised = await isCompromisedPassword(input.password); } catch { return res.status(503).json({ success: false, message: "Password safety validation is temporarily unavailable. Please try again." }); } if (compromised) return res.status(400).json({ success: false, message: "Choose a password that has not appeared in known data breaches." }); const passwordHash = await bcrypt.hash(input.password, 12); const completed = await prisma.$transaction(async (tx) => { if ((await tx.passwordResetToken.updateMany({ where: { id: reset.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } })).count !== 1) return false; await tx.user.update({ where: { id: reset.user.id }, data: { passwordHash } }); await tx.session.updateMany({ where: { userId: reset.user.id, revokedAt: null }, data: { revokedAt: new Date() } }); await tx.passwordResetToken.updateMany({ where: { userId: reset.user.id, consumedAt: null }, data: { consumedAt: new Date() } }); return true; }); return completed ? res.json({ success: true, message: "Your password has been reset. Sign in with your new password." }) : res.status(400).json({ success: false, message: "This password reset link is invalid or expired." }); } catch (error) { next(error); } });
app.post("/api/auth/login", rateLimit("login", 8, 900000), async (req, res, next) => { try { const input = loginSchema.parse(req.body), user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } }); if (!user || !user.isActive || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ success: false, message: "Invalid email or password." }); if (!user.twoFactorEnabled) { await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }); await createChallenge(user.id, TwoFactorChallengeType.ENROLLMENT, input.rememberMe, res); return res.json({ success: true, requiresTwoFactorSetup: true }); } await createChallenge(user.id, TwoFactorChallengeType.LOGIN, input.rememberMe, res); return res.json({ success: true, requiresTwoFactorVerification: true }); } catch (error) { next(error); } });
app.post("/api/auth/2fa/setup", rateLimit("setup", 8, 900000), async (req, res, next) => { try { const challenge = await getChallenge(req, TwoFactorChallengeType.ENROLLMENT); if (!challenge || !challenge.user.isActive || challenge.user.twoFactorEnabled) return res.status(401).json({ success: false, message: "Your setup session has expired. Sign in again." }); const now = new Date(), candidateSecret = generateTotpSecret(); await prisma.user.updateMany({ where: { id: challenge.userId, isActive: true, twoFactorEnabled: false, OR: [{ twoFactorPendingSecretEncrypted: null }, { twoFactorPendingExpiresAt: null }, { twoFactorPendingExpiresAt: { lte: now } }] }, data: { twoFactorPendingSecretEncrypted: encryptTotpSecret(candidateSecret, encryptionKey), twoFactorPendingExpiresAt: new Date(Date.now() + pendingMinutes * 60000) } }); const user = await prisma.user.findUnique({ where: { id: challenge.userId, isActive: true, twoFactorEnabled: false }, select: { email: true, twoFactorPendingSecretEncrypted: true, twoFactorPendingExpiresAt: true } }); if (!user?.twoFactorPendingSecretEncrypted || !user.twoFactorPendingExpiresAt || user.twoFactorPendingExpiresAt <= now) return res.status(401).json({ success: false, message: "Your setup session has expired. Sign in again." }); const secret = decryptTotpSecret(user.twoFactorPendingSecretEncrypted, encryptionKey), uri = createProvisioningUri(secret, user.email); return res.json({ success: true, enrollmentId: enrollmentFingerprint(challenge.id, user.twoFactorPendingSecretEncrypted), qrCodeDataUrl: await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 256 }), manualSetupKey: secret }); } catch (error) { next(error); } });
app.post("/api/auth/2fa/verify-setup", rateLimit("setup-verify", 10, 300000), async (req, res, next) => {
  const expired = { success: false, code: "SETUP_EXPIRED", message: "Your setup session has expired. Sign in again." };
  const replaced = { success: false, code: "SETUP_REPLACED", message: "This setup session was replaced. Refresh the QR code to continue." };
  try {
    const input = setupVerificationSchema.parse(req.body);
    const challenge = await getChallenge(req, TwoFactorChallengeType.ENROLLMENT);
    if (!challenge?.user.isActive || challenge.user.twoFactorEnabled) return res.status(401).json(expired);

    const { twoFactorPendingSecretEncrypted: encryptedSecret, twoFactorPendingExpiresAt: pendingExpiresAt } = challenge.user;
    if (!encryptedSecret || !pendingExpiresAt || pendingExpiresAt <= new Date()) {
      return res.status(409).json({ ...replaced, message: "This setup QR code has expired. Refresh the QR code to continue." });
    }

    const expectedId = enrollmentFingerprint(challenge.id, encryptedSecret);
    if (!crypto.timingSafeEqual(Buffer.from(input.enrollmentId, "hex"), Buffer.from(expectedId, "hex"))) {
      return res.status(409).json(replaced);
    }

    const secret = decryptTotpSecret(encryptedSecret, encryptionKey);
    if (!verifyTotp(secret, challenge.user.email, input.code)) {
      return res.status(401).json({ success: false, code: "INVALID_AUTHENTICATOR_CODE", message: "Invalid authenticator code." });
    }

    const codes = recoveryCodes();
    const rows = await Promise.all(codes.map(async (code) => ({ userId: challenge.userId, codeHash: await bcrypt.hash(normalizeCode(code), 12) })));
    const enrollmentChanged = new Error("Enrollment changed during verification.");
    try {
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const consumed = await tx.twoFactorChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
        if (consumed.count !== 1) throw enrollmentChanged;

        const updated = await tx.user.updateMany({
          where: {
            id: challenge.userId,
            isActive: true,
            twoFactorEnabled: false,
            twoFactorPendingSecretEncrypted: encryptedSecret,
            twoFactorPendingExpiresAt: { gt: now },
          },
          data: {
            twoFactorEnabled: true,
            twoFactorSecretEncrypted: encryptedSecret,
            twoFactorPendingSecretEncrypted: null,
            twoFactorPendingExpiresAt: null,
            twoFactorEnabledAt: now,
          },
        });
        if (updated.count !== 1) throw enrollmentChanged;

        await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: challenge.userId } });
        await tx.twoFactorRecoveryCode.createMany({ data: rows });
      });
    } catch (error) {
      if (error === enrollmentChanged) return res.status(401).json(expired);
      throw error;
    }

    const user = { id: challenge.user.id, email: challenge.user.email, role: challenge.user.role };
    const refresh = await makeSession(user.id, challenge.rememberMe, req.get("user-agent"));
    res.clearCookie(challengeCookie, challengeOptions);
    res.cookie("hrms_refresh_token", refresh, cookieOptions(challenge.rememberMe));
    return res.json({ success: true, accessToken: accessToken(user), user, recoveryCodes: codes });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/2fa/verify-login", rateLimit("login-verify", 10, 300000), async (req, res, next) => { try { const input = verificationSchema.parse(req.body), challenge = await getChallenge(req, TwoFactorChallengeType.LOGIN); if (!challenge || !challenge.user.isActive || !challenge.user.twoFactorEnabled) return res.status(401).json({ success: false, message: "Your verification session has expired. Sign in again." }); if (!(await secondFactor(challenge.user, input.code, input.recoveryCode))) return res.status(401).json({ success: false, message: "Invalid verification code." }); if (!(await consumeChallenge(challenge.id))) return res.status(401).json({ success: false, message: "Your verification session has expired. Sign in again." }); return completeLogin(challenge.user, challenge.rememberMe, req, res).then(() => undefined); } catch (error) { next(error); } });
app.post("/api/auth/refresh", async (req, res, next) => {
  try {
    const token = req.cookies.hrms_refresh_token as string | undefined;
    if (!token) return deny(res);

    let payload: string | JwtPayload;
    try {
      payload = jwt.verify(token, signingSecret);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) return deny(res);
      throw error;
    }
    if (typeof payload === "string" || typeof payload.sid !== "string") return deny(res);

    const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive || !session.user.twoFactorEnabled || !(await bcrypt.compare(token, session.refreshTokenHash))) return deny(res);

    // Cookies issued before rememberMe was included retain the previous refresh behavior.
    const rememberMe = payload.rememberMe !== false;
    const fresh = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const revoked = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now }, user: { isActive: true, twoFactorEnabled: true } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) return null;
      return makeSession(session.userId, rememberMe, req.get("user-agent"), tx);
    });
    if (!fresh) return deny(res);

    res.cookie("hrms_refresh_token", fresh, cookieOptions(rememberMe));
    return res.json({ success: true, accessToken: accessToken(session.user) });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/logout", async (req, res) => { const token = req.cookies.hrms_refresh_token as string | undefined; if (token) try { const payload = jwt.verify(token, signingSecret) as JwtPayload; if (typeof payload.sid === "string") await prisma.session.updateMany({ where: { id: payload.sid }, data: { revokedAt: new Date() } }); } catch {} res.clearCookie("hrms_refresh_token", cookieOptions(false)); res.clearCookie(challengeCookie, challengeOptions); return res.status(204).send(); });
app.get("/api/auth/me", authenticate, authorize(Role.OWNER, Role.ADMIN), async (req: AuthRequest, res, next) => { try { const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, email: true, role: true, isActive: true } }); return !user || !user.isActive ? deny(res) : res.json({ success: true, user }); } catch (error) { next(error); } });
app.get("/api/auth/2fa/status", authenticate, async (req: AuthRequest, res, next) => { try { const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { twoFactorEnabled: true, twoFactorEnabledAt: true } }); return res.json({ success: true, twoFactorEnabled: user?.twoFactorEnabled ?? false, twoFactorEnabledAt: user?.twoFactorEnabledAt ?? null }); } catch (error) { next(error); } });
async function verifiedUser(req: AuthRequest, input: z.infer<typeof sensitiveSchema>) { const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } }); return user && user.isActive && await bcrypt.compare(input.password, user.passwordHash) && await secondFactor(user, input.code, input.recoveryCode) ? user : null; }
app.post("/api/auth/2fa/recovery-codes/regenerate", authenticate, rateLimit("regen", 5, 900000), async (req: AuthRequest, res, next) => { try { const input = sensitiveSchema.parse(req.body), user = await verifiedUser(req, input); if (!user) return res.status(401).json({ success: false, message: "Unable to verify your identity." }); const codes = recoveryCodes(), rows = await Promise.all(codes.map(async (code) => ({ userId: user.id, codeHash: await bcrypt.hash(normalizeCode(code), 12) }))); await prisma.$transaction([prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }), prisma.twoFactorRecoveryCode.createMany({ data: rows })]); return res.json({ success: true, recoveryCodes: codes }); } catch (error) { next(error); } });
app.post("/api/auth/2fa/disable", authenticate, rateLimit("disable", 5, 900000), async (req: AuthRequest, res, next) => { try { const input = sensitiveSchema.parse(req.body), user = await verifiedUser(req, input); if (!user) return res.status(401).json({ success: false, message: "Unable to verify your identity." }); await prisma.$transaction([prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null, twoFactorPendingSecretEncrypted: null, twoFactorPendingExpiresAt: null, twoFactorEnabledAt: null } }), prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }), prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })]); return res.json({ success: true }); } catch (error) { next(error); } });
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Please provide valid request data." }); console.error(error); return res.status(500).json({ success: false, message: "An unexpected server error occurred." }); });
app.listen(PORT, () => console.log(`HRMS Super Admin API running at http://localhost:${PORT}`));
