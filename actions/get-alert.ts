import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
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
  description: "Get one SafeSignal SOS alert by id.",
  readOnly: true,
  schema: z.object({
    id: z.string().describe("Alert id"),
  }),
  http: { method: "GET" },
  outputSchema: alertOutput,
  run: async (args, ctx) => {
    const db = getDb();
    const [row] = await db
      .select()
      .from(safesignalAlerts)
      .where(
        and(
          eq(safesignalAlerts.id, args.id),
          eq(safesignalAlerts.ownerEmail, ownerOf(ctx)),
        ),
      )
      .limit(1);
    if (!row) {
      fail("SOS alert not found.", { errorCode: "not_found", statusCode: 404 });
    }
    return {
      id: row.id,
      status: row.status,
      message: row.message,
      recipients: row.recipients as unknown as SosRecipient[],
      delivery: (row.delivery as unknown as DeliveryEntry[]) ?? [],
      distressScore: row.distressScore,
      sustainedSeconds: row.sustainedSeconds,
      locationText: row.locationText,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});
