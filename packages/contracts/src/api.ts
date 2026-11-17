import { z } from 'zod';

export const profileCredentialsSchema = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200)
});

export type ProfileCredentials = z.infer<typeof profileCredentialsSchema>;

export type ProfileUser = { id: string; name: string };

export type AuthState = { hasUsers: boolean; user: ProfileUser | null };

export type ProfileResponse = { user: ProfileUser };

export const DEMO_PROFILE = { name: 'demo', password: 'demodemo' } as const;

export const DEMO_ATTEMPT_FIXTURES = ['player-run', 'h3-wide-apex', 'h3-wide-finish'] as const;

export type DemoAttemptFixture = (typeof DEMO_ATTEMPT_FIXTURES)[number];

export type DemoInfo = { profileName: string; password: string; ready: boolean };

export type AppInfo = { demo: DemoInfo | null };

export type DemoAttemptResponse = { fixture: DemoAttemptFixture };
