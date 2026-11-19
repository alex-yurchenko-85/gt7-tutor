import { z } from 'zod';

export const profileCredentialsSchema = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200)
});

export type ProfileCredentials = z.infer<typeof profileCredentialsSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: profileCredentialsSchema.shape.password
  })
  .strict();

export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const deleteProfileSchema = z.object({ password: profileCredentialsSchema.shape.password }).strict();

export type DeleteProfileRequest = z.infer<typeof deleteProfileSchema>;

export type ProfileUser = { id: string; name: string };

export type AuthState = { hasUsers: boolean; user: ProfileUser | null };

export type ProfileCard = { name: string };

export type ProfileResponse = { user: ProfileUser };

export const DEMO_PROFILE = { name: 'demo', password: 'demodemo' } as const;

export const DEMO_ATTEMPT_FIXTURES = ['ce-clean', 'ce-slow', 'ce-pause'] as const;

export type DemoAttemptFixture = (typeof DEMO_ATTEMPT_FIXTURES)[number];

export type DemoInfo = { profileName: string; password: string; ready: boolean };

export type AppInfo = { demo: DemoInfo | null; consoleRequired: boolean };

export type DemoAttemptResponse = { fixture: DemoAttemptFixture };
