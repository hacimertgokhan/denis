"use client";

import { emailOTPClient, inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "@/lib/auth";

export const authClient = createAuthClient({ plugins: [emailOTPClient(), twoFactorClient(), inferAdditionalFields<typeof auth>()] });

export const { signIn, signUp, signOut, useSession } = authClient;
