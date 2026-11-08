import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { DeliveryEntry, SosRecipient } from "../shared/safesignal.js";
import { getDb, safesignalAlerts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";

const recipientOutput = z.object({
  kind: z.enum(["contact", "authority"]),
  name: z.string(),
  phone: z.string(),
});

const deliveryOutput = z.object({
  kind: z.enum(["contact", "authority"]),
  name: z.string(),
  phone: z.string(),
  sentAt: z.string(),
  deliveredAt: z.string(),
});

const alertOutput = z.object({
  id: z.string(),
  status: z.string(),
  message: z.string(),
  recipients: z.array(recipientOutput),
  delivery: z.array(deliveryOutput),
  distressScore: z.number(),
  sustainedSeconds: z.number(),
  locationText: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export default defineAction({
  description:
    "List SafeSignal SOS alerts (drafts, sent-simulated, dismissed), newest first.",
  readOnly: true,
  schema: z.object({}),
  http: { method: "GET" },
  outputSchema: z.object({ alerts: z.array(alertOutput) }),
  run: async (_args, ctx) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(safesignalAlerts)
      .where(eq(safesignalAlerts.ownerEmail, ownerOf(ctx)))
      .orderBy(desc(safesignalAlerts.createdAt))
      .limit(50);
    return {
      alerts: rows.map((r) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        recipients: r.recipients as unknown as SosRecipient[],
        delivery: (r.delivery as unknown as DeliveryEntry[]) ?? [],
        distressScore: r.distressScore,
        sustainedSeconds: r.sustainedSeconds,
        locationText: r.locationText,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  },
});
