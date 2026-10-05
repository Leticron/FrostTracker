import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, digits, "_", "." and "-"');

export const passwordSchema = z.string().min(10).max(256);

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
