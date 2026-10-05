import { hash, verify } from '@node-rs/argon2';

// Algorithm.Argon2id === 2 in @node-rs/argon2. The library's default parameters are used;
// they are encoded in the PHC string, so raising them later stays compatible.
const ARGON2ID = 2;

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}

/** A valid hash of a random string, verified against when the user doesn't exist (timing). */
let dummyHash: Promise<string> | undefined;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(crypto.randomUUID());
  return dummyHash.then((h) => verifyPassword(h, password));
}
