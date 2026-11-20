import * as OTPAuth from "otpauth";

export const TOTP_ISSUER = "HRMS Super Admin";
export const TOTP_ALGORITHM = "SHA1";
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;

export function generateTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function createTotp(secret: string, email: string) {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function createProvisioningUri(secret: string, email: string) {
  return createTotp(secret, email).toString();
}

export function verifyTotp(secret: string, email: string, code: string, timestamp = Date.now()) {
  return /^\d{6}$/.test(code) && createTotp(secret, email).validate({ token: code, timestamp, window: 1 }) !== null;
}
