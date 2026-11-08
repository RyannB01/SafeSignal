import { getSetting } from "@agent-native/core/settings";

import {
  DEFAULT_SETTINGS,
  SAFESIGNAL_SETTINGS_KEY,
  type SafeSignalSettings,
} from "../../shared/safesignal.js";

/**
 * Owner scope for SafeSignal rows. In production this is the signed-in
 * user's email from the action context. Local dev has no real user, so rows
 * fall back to the single "local-dev" owner — this is a single-user safety
 * demo, not a multi-tenant product.
 */
export function ownerOf(ctx?: { userEmail?: string }): string {
  return ctx?.userEmail ?? "local-dev";
}

export async function readSettings(): Promise<SafeSignalSettings> {
  const raw = await getSetting(SAFESIGNAL_SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...((raw ?? {}) as Partial<SafeSignalSettings>) };
}
