import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { SosRecipient } from "../shared/safesignal.js";
import { getDb, safesignalAlerts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";

export default defineAction({
  description:
    "Dismiss a check-in (the user pressed \"I'm OK\"). The draft SOS alert is marked dismissed and nothing is sent.",
  schema: z.object({
    id: z.string().describe("Draft alert id"),
  }),
  outputSchema: z.object({
    id: z.string(),
    status: z.string(),
    dismissed: z.boolean(),
  }),
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
      fail(`This alert is ${existing.status} and can no longer be dismissed.`, {
        errorCode: "not_draft",
        statusCode: 409,
      });
    }
    const [updated] = await db
      .update(safesignalAlerts)
      .set({ status: "dismissed", updatedAt: new Date().toISOString() })
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
    return { id: updated.id, status: updated.status, dismissed: true };
  },
});
