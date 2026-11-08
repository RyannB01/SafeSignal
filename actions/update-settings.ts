import { defineAction, fail } from "@agent-native/core/action";
import { putSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  isValidLaptopKey,
  normalizeLaptopKey,
  PHONE_BUTTON_OPTIONS,
  SAFESIGNAL_SETTINGS_KEY,
  type SafeSignalSettings,
} from "../shared/safesignal.js";
import { readSettings } from "../server/lib/safesignal-actions.js";

const settingsOutput = z.object({
  protectionOn: z.boolean(),
  thresholdSeconds: z.number(),
  demoMode: z.boolean(),
  autoEscalate: z.boolean(),
  phoneButtons: z.array(z.string()),
  laptopKeys: z.array(z.string()),
  soundAlarm: z.boolean(),
  holdToConfirm: z.boolean(),
});

export default defineAction({
  description:
    "Update SafeSignal protection settings (patch: only the fields given change). Threshold is 5–60 seconds. Confirmation is a physical chord: phone buttons (at least 2 of Volume Up / Volume Down / Power — needs the native app, a web page cannot read them) and laptop keys (at least 2 keys, held together — works in this demo). ALL chosen inputs must be held together to send an SOS. Sound-the-alarm is off by default (silent/stealth); hold-the-chord is off by default (instant confirmation is faster in a crisis).",
  schema: z.object({
    protectionOn: z
      .boolean()
      .optional()
      .describe("Turn distress monitoring on or off"),
    thresholdSeconds: z
      .number()
      .int()
      .min(5)
      .max(60)
      .optional()
      .describe("Seconds of sustained distress before the check-in fires (5–60)"),
    demoMode: z
      .boolean()
      .optional()
      .describe("Demo mode drops the effective threshold to 8 seconds"),
    autoEscalate: z
      .boolean()
      .optional()
      .describe("Auto-send the alert if nobody answers the check-in window"),
    phoneButtons: z
      .array(z.string())
      .optional()
      .describe(
        "Physical phone buttons for SOS confirmation; at least 2 of Volume Up, Volume Down, Power — all must be pressed together to send",
      ),
    laptopKeys: z
      .array(z.string())
      .optional()
      .describe(
        "Laptop keyboard keys for SOS confirmation; at least 2, all must be held together as a chord to send",
      ),
    soundAlarm: z
      .boolean()
      .optional()
      .describe(
        "Sound a loud alarm after the SOS is sent; default off (silent/stealth so an aggressor is not alerted)",
      ),
    holdToConfirm: z
      .boolean()
      .optional()
      .describe(
        "Hold the whole chord for 2 seconds to confirm instead of confirming the moment it is complete; default off",
      ),
  }),
  outputSchema: settingsOutput,
  run: async (args) => {
    const current = await readSettings();
    const next: SafeSignalSettings = { ...current };
    if (args.protectionOn !== undefined) next.protectionOn = args.protectionOn;
    if (args.thresholdSeconds !== undefined)
      next.thresholdSeconds = args.thresholdSeconds;
    if (args.demoMode !== undefined) next.demoMode = args.demoMode;
    if (args.autoEscalate !== undefined) next.autoEscalate = args.autoEscalate;
    if (args.soundAlarm !== undefined) next.soundAlarm = args.soundAlarm;
    if (args.holdToConfirm !== undefined) next.holdToConfirm = args.holdToConfirm;
    if (args.phoneButtons !== undefined) {
      const unknown = args.phoneButtons.filter(
        (b) => !(PHONE_BUTTON_OPTIONS as readonly string[]).includes(b),
      );
      if (unknown.length > 0) {
        fail(`Unknown phone button(s): ${unknown.join(", ")}`, {
          errorCode: "invalid_button",
          statusCode: 400,
        });
      }
      if (args.phoneButtons.length < 2) {
        fail("Choose at least 2 phone buttons.", {
          errorCode: "too_few_buttons",
          statusCode: 400,
        });
      }
      next.phoneButtons = [...new Set(args.phoneButtons)] as SafeSignalSettings["phoneButtons"];
    }
    if (args.laptopKeys !== undefined) {
      const normalized = args.laptopKeys.map((k) => normalizeLaptopKey(k));
      const invalid = args.laptopKeys.filter((_, i) => normalized[i] === null);
      if (invalid.length > 0) {
        fail(`Unknown laptop key(s): ${invalid.join(", ")}`, {
          errorCode: "invalid_key",
          statusCode: 400,
        });
      }
      const keys = [...new Set(normalized as string[])];
      if (keys.length < 2) {
        fail("Choose at least 2 laptop keys.", {
          errorCode: "too_few_keys",
          statusCode: 400,
        });
      }
      if (!keys.every(isValidLaptopKey)) {
        fail("Invalid laptop key in chord.", {
          errorCode: "invalid_key",
          statusCode: 400,
        });
      }
      next.laptopKeys = keys;
    }
    await putSetting(SAFESIGNAL_SETTINGS_KEY, next as unknown as Record<string, unknown>);
    return next;
  },
});
