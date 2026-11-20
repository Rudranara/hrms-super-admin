import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import * as OTPAuth from "otpauth";
import { createProvisioningUri, createTotp, generateTotpSecret, TOTP_ALGORITHM, TOTP_DIGITS, TOTP_ISSUER, TOTP_PERIOD, verifyTotp } from "./totp";
import { decryptTotpSecret, encryptTotpSecret } from "./totp-crypto";

const email = "owner@example.com";
const secret = "JBSWY3DPEHPK3PXP";
const timestamp = 1_700_000_000_000;

function independentTotp(secretBytes: Buffer, timestampMs: number, digits: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestampMs / 1000 / TOTP_PERIOD)));
  const digest = crypto.createHmac("sha1", secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 10 ** digits).padStart(digits, "0");
}

test("matches an independent Node crypto RFC 6238 SHA-1 implementation", () => {
  const rfcSecret = Buffer.from("12345678901234567890", "ascii");
  const rfcTimestamp = 59_000;
  assert.equal(independentTotp(rfcSecret, rfcTimestamp, 8), "94287082");
  const otpAuthCode = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromLatin1(rfcSecret.toString("latin1")) }).generate({ timestamp: rfcTimestamp });
  assert.equal(otpAuthCode, independentTotp(rfcSecret, rfcTimestamp, 6));
});

test("generates valid Base32 secrets and encrypts them without changing their value", () => {
  const generated = generateTotpSecret();
  assert.match(generated, /^[A-Z2-7]+$/);
  const key = crypto.randomBytes(32);
  assert.equal(decryptTotpSecret(encryptTotpSecret(generated, key), key), generated);
  assert.throws(() => decryptTotpSecret(encryptTotpSecret(generated, key), crypto.randomBytes(32)));
});

test("uses matching RFC 6238 provisioning and verification settings", () => {
  const uri = new URL(createProvisioningUri(secret, email));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.hostname, "totp");
  assert.equal(uri.searchParams.get("issuer"), TOTP_ISSUER);
  assert.equal(uri.searchParams.get("secret"), secret);
  assert.equal(uri.searchParams.get("algorithm"), TOTP_ALGORITHM);
  assert.equal(uri.searchParams.get("digits"), String(TOTP_DIGITS));
  assert.equal(uri.searchParams.get("period"), String(TOTP_PERIOD));
});

test("accepts a code generated from the Base32 secret extracted from the provisioning URI", () => {
  const provisioning = createProvisioningUri(secret, email);
  const parsed = OTPAuth.URI.parse(provisioning);
  assert.ok(parsed instanceof OTPAuth.TOTP);
  assert.equal(parsed.secret.base32, secret);
  const code = parsed.generate({ timestamp });
  assert.equal(verifyTotp(parsed.secret.base32, email, code, timestamp), true);
});

test("accepts the correct six-digit code, including a leading zero, at a fixed timestamp", () => {
  let leadingZeroTimestamp = timestamp;
  let code = createTotp(secret, email).generate({ timestamp: leadingZeroTimestamp });
  while (!code.startsWith("0")) {
    leadingZeroTimestamp += TOTP_PERIOD * 1000;
    code = createTotp(secret, email).generate({ timestamp: leadingZeroTimestamp });
  }
  assert.equal(code.length, 6);
  assert.equal(verifyTotp(secret, email, code, leadingZeroTimestamp), true);
  assert.equal(verifyTotp(secret, email, String(Number(code)), leadingZeroTimestamp), false);
});

test("rejects invalid and expired codes while allowing exactly one adjacent time step", () => {
  const code = createTotp(secret, email).generate({ timestamp });
  assert.equal(verifyTotp(secret, email, code === "999999" ? "999998" : "999999", timestamp), false);
  assert.equal(verifyTotp(secret, email, code, timestamp + TOTP_PERIOD * 1000), true);
  assert.equal(verifyTotp(secret, email, code, timestamp + TOTP_PERIOD * 2 * 1000), false);
});
