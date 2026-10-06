import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, digits, "_", "." and "-"');

// Frequent 10+ character passwords from public breach top lists, plus a few local ones.
const commonPasswords = new Set([
  '0123456789',
  '1234567890',
  '12345678910',
  '0987654321',
  '1111111111',
  'password12',
  'password123',
  'password1234',
  'passwort123',
  'passwort1234',
  'qwertyuiop',
  'qwertzuiop',
  'qwerty1234',
  'qwerty12345',
  'qwerty123456',
  'asdfghjkl1',
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'zaq12wsxcde3',
  'iloveyou12',
  'abcdefghij',
  'abc1234567',
  'letmein123',
  'welcome123',
  'changeme123',
  'administrator',
  'frosthaven',
  'frosthaven1',
  'frosthaven123',
  'gloomhaven1',
  'gloomhaven123',
  'frosttracker',
]);
const sequences = [
  '01234567890123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
];

/** Why a password is too easy to guess, or null. Length is checked by the schema. */
export function passwordProblem(password: string): string | null {
  const p = password.toLowerCase();
  if (commonPasswords.has(p)) return 'This password is too common';
  if (/^(.)\1+$/.test(p)) return 'This password is just one repeated character';
  if (sequences.some((s) => s.includes(p) || [...s].reverse().join('').includes(p)))
    return 'This password is a simple sequence';
  return null;
}

export const passwordSchema = z
  .string()
  .min(10)
  .max(256)
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const loginInput = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginInput>;

export const registerInput = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(64).optional(),
  password: passwordSchema,
  inviteCode: z.string().trim().min(1).max(128).optional(),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
