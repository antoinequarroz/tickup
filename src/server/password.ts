import crypto from "node:crypto";

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

// One hash at a time, off the event loop: a flood of login attempts must not stall the server.
let hashing: Promise<unknown> = Promise.resolve();
function scrypt(password: string, salt: string): Promise<string> {
  const run = hashing.then(() => new Promise<string>((resolve, reject) => crypto.scrypt(password, salt, 32, (e, key) => (e ? reject(e) : resolve(key.toString("hex"))))));
  hashing = run.catch(() => {});
  return run;
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: await scrypt(password, salt) };
}

const DUMMY_SALT = crypto.randomBytes(16).toString("hex");

/** Checks a password. Without an account, a hash is still computed so the answer takes the same time. */
export async function verifyPassword(given: unknown, account: { salt: string; hash: string } | null): Promise<boolean> {
  if (typeof given !== "string" || !given || given.length > MAX_PASSWORD) return false;
  const computed = Buffer.from(await scrypt(given, account?.salt ?? DUMMY_SALT), "hex");
  if (!account) return false;
  const expected = Buffer.from(account.hash, "hex");
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

export const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD;
