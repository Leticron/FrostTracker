import { describe, expect, it } from 'vitest';
import { passwordProblem, passwordSchema } from '../src/auth.ts';

describe('password policy', () => {
  it('rejects common passwords, repeats and sequences', () => {
    expect(passwordProblem('Password123')).toMatch(/common/);
    expect(passwordProblem('qwertzuiop')).toMatch(/common/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/repeated/);
    expect(passwordProblem('3456789012')).toMatch(/sequence/);
    expect(passwordProblem('jihgfedcba')).toMatch(/sequence/);
  });

  it('accepts ordinary passphrases', () => {
    expect(passwordProblem('correct horse battery')).toBeNull();
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it('keeps the length limits', () => {
    expect(passwordSchema.safeParse('short1!').success).toBe(false);
    expect(passwordSchema.safeParse('x'.repeat(257)).success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(false);
  });
});
