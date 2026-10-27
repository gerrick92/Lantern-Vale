import "server-only";
import { cache } from "react";
import { authConfigured } from "@/lib/auth-config";
import { sessionClient } from "./auth";

// React's cache is scoped to this server render, never shared across users.
export const currentUser = cache(async () => {
  if (!authConfigured) return null;
  const client = await sessionClient();
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
});
