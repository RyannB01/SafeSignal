import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

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
    "Read the SafeSignal protection settings: protection on/off, distress threshold in seconds, demo mode, auto-escalate, the chosen physical confirmation inputs — phone buttons (Volume Up/Down, Power; needs the native app) and laptop keys (works in this demo) — sound-the-alarm (default off), and hold-the-chord (default off).",
  readOnly: true,
  schema: z.object({}),
  http: { method: "GET" },
  outputSchema: settingsOutput,
  run: async () => {
    return await readSettings();
  },
});
