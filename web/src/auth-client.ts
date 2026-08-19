import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export type SocialProvider = "google" | "facebook" | "discord";
