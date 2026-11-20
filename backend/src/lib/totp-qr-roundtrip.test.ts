import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import QRCode from "qrcode";
import { decryptTotpSecret, encryptTotpSecret } from "./totp-crypto";
import { createProvisioningUri, generateTotpSecret, TOTP_ALGORITHM, TOTP_DIGITS, TOTP_ISSUER, TOTP_PERIOD, verifyTotp } from "./totp";

type DecodedPng = { width: number; height: number; data: Buffer };
const { PNG } = require("pngjs") as { PNG: { sync: { read(input: Buffer): DecodedPng } } };

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const digit = alphabet.indexOf(character);
    assert.notEqual(digit, -1, "The generated secret must be valid Base32.");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function independentTotp(secret: string, timestampMs: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestampMs / (TOTP_PERIOD * 1000))));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

test("independently decodes the generated TOTP QR PNG and verifies its code", async () => {
  const email = "qr-roundtrip@example.invalid";
  const originalSecret = generateTotpSecret();
  const encryptionKey = crypto.randomBytes(32);
  const decryptedSecret = decryptTotpSecret(encryptTotpSecret(originalSecret, encryptionKey), encryptionKey);
  assert.equal(decryptedSecret, originalSecret);

  const provisioningUri = createProvisioningUri(decryptedSecret, email);
  const dataUrl = await QRCode.toDataURL(provisioningUri, { errorCorrectionLevel: "M", margin: 1, width: 256 });
  const png = PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  const luminance = new Uint8ClampedArray(png.width * png.height);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) luminance[pixel] = png.data[pixel * 4];
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, png.width, png.height)));
  const extractedUri = new QRCodeReader().decode(bitmap).getText();
  const extracted = new URL(extractedUri);

  assert.equal(extracted.protocol, "otpauth:");
  assert.equal(extracted.hostname, "totp");
  assert.equal(extracted.searchParams.get("secret"), originalSecret);
  assert.equal(extracted.searchParams.get("issuer"), TOTP_ISSUER);
  assert.equal(extracted.searchParams.get("algorithm"), TOTP_ALGORITHM);
  assert.equal(extracted.searchParams.get("digits"), String(TOTP_DIGITS));
  assert.equal(extracted.searchParams.get("period"), String(TOTP_PERIOD));

  const fixedTimestamp = 1_700_000_000_000;
  const independentlyCalculatedCode = independentTotp(extracted.searchParams.get("secret")!, fixedTimestamp);
  assert.equal(verifyTotp(originalSecret, email, independentlyCalculatedCode, fixedTimestamp), true);
});
