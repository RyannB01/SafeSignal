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
  description:
    "Edit a draft SOS alert before it is confirmed — change the message text or the recipient list. Only a draft can be edited; a sent or dismissed alert is rejected.",
  schema: z.object({
    id: z.string().describe("Alert id"),
    message: z.string().optional().describe("Replacement alert message text"),
    recipients: z
      .array(
        z.object({
          kind: z.enum(["contact", "authority"]),
          name: z.string(),
          phone: z.string(),
        }),
      )
      .optional()
      .describe("Replacement recipient list (emergency contacts and/or 112)"),
  }),
  outputSchema: alertOutput,
  run: async (args, ctx) => {
    const db = getDb();
    const owner = ownerOf(ctx);
    const [existing] = await db
      .select()
      .from(safesignalAlerts)
      .where(
        and(
          eq(safesignalAlerts.id, args.id),
          eq(safesignalAlerts.ownerEmail, owner),
        ),
      )
      .limit(1);
    if (!existing) {
      fail("SOS alert not found.", { errorCode: "not_found", statusCode: 404 });
    }
    if (existing.status !== "draft") {
      fail(`Only a draft can be edited; this alert is ${existing.status}.`, {
        errorCode: "not_draft",
        statusCode: 409,
      });
    }
    const patch: Partial<typeof existing> = {
      updatedAt: new Date().toISOString(),
    };
    if (args.message !== undefined) patch.message = args.message;
    if (args.recipients !== undefined)
      patch.recipients = args.recipients as unknown as Record<string, unknown>[];
    const [updated] = await db
      .update(safesignalAlerts)
      .set(patch)
      .where(
        and(
          eq(safesignalAlerts.id, args.id),
          eq(safesignalAlerts.ownerEmail, owner),
          eq(safesignalAlerts.status, "draft"),
        ),
      )
      .returning();
    if (!updated) {
      fail("This alert is no longer a draft.", {
        errorCode: "not_draft",
        statusCode: 409,
      });
    }
    return {
      id: updated.id,
      status: updated.status,
      message: updated.message,
      recipients: updated.recipients as unknown as SosRecipient[],
      delivery: (updated.delivery as unknown as DeliveryEntry[]) ?? [],
      distressScore: updated.distressScore,
      sustainedSeconds: updated.sustainedSeconds,
      locationText: updated.locationText,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  },
});
