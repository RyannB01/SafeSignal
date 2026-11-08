import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  UNDO_WINDOW_SECONDS,
  buildFalseAlarmMessage,
} from "../shared/safesignal.js";
import { getDb, safesignalAlerts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";

export default defineAction({
  description:
    "Undo a just-sent SOS as a mistake, within the 10-second undo window. The alert becomes cancelled and the emergency contacts get a quiet 'False alarm, I'm OK' message (simulated — no real message is sent). After the window closes, use send-all-clear instead.",
  schema: z.object({
    id: z.string().describe("Sent alert id"),
  }),
  outputSchema: z.object({
    id: z.string(),
    status: z.string(),
    cancelled: z.boolean(),
    falseAlarmMessage: z.string(),
    summary: z.string(),
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
    if (existing.status !== "sent-simulated") {
      fail(`Only a just-sent SOS can be cancelled; this alert is ${existing.status}.`, {
        errorCode: "not_sent",
        statusCode: 409,
      });
    }
    const sentAt = Date.parse(existing.updatedAt);
    const elapsedSeconds = (Date.now() - sentAt) / 1000;
    if (elapsedSeconds > UNDO_WINDOW_SECONDS) {
      fail(
        `The ${UNDO_WINDOW_SECONDS}-second undo window has closed. Use send-all-clear instead.`,
        { errorCode: "undo_window_expired", statusCode: 409 },
      );
    }
    const [updated] = await db
      .update(safesignalAlerts)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(safesignalAlerts.id, args.id),
          eq(safesignalAlerts.ownerEmail, owner),
          eq(safesignalAlerts.status, "sent-simulated"),
        ),
      )
      .returning();
    if (!updated) {
      fail("This alert can no longer be cancelled.", {
        errorCode: "not_sent",
        statusCode: 409,
      });
    }
    return {
      id: updated.id,
      status: updated.status,
      cancelled: true,
      falseAlarmMessage: buildFalseAlarmMessage(owner),
      summary:
        "SOS cancelled as a mistake (SIMULATED — contacts would get a quiet 'False alarm, I'm OK' message; no real message was sent).",
    };
  },
});
