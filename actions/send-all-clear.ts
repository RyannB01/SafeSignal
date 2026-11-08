import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  UNDO_WINDOW_SECONDS,
  buildAllClearMessage,
} from "../shared/safesignal.js";
import { getDb, safesignalAlerts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";

export default defineAction({
  description:
    "Send an all-clear for a sent SOS after the 10-second undo window has closed. The alert becomes all-clear and contacts get a 'safe now' message (simulated — no real message is sent). Inside the undo window, use cancel-sos-alert instead.",
  schema: z.object({
    id: z.string().describe("Sent alert id"),
  }),
  outputSchema: z.object({
    id: z.string(),
    status: z.string(),
    allClear: z.boolean(),
    allClearMessage: z.string(),
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
      fail(`Only a sent SOS can be stood down; this alert is ${existing.status}.`, {
        errorCode: "not_sent",
        statusCode: 409,
      });
    }
    const sentAt = Date.parse(existing.updatedAt);
    const elapsedSeconds = (Date.now() - sentAt) / 1000;
    if (elapsedSeconds <= UNDO_WINDOW_SECONDS) {
      fail(
        `The ${UNDO_WINDOW_SECONDS}-second undo window is still open — use cancel-sos-alert for a mistake.`,
        { errorCode: "undo_window_open", statusCode: 409 },
      );
    }
    const [updated] = await db
      .update(safesignalAlerts)
      .set({ status: "all-clear", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(safesignalAlerts.id, args.id),
          eq(safesignalAlerts.ownerEmail, owner),
          eq(safesignalAlerts.status, "sent-simulated"),
        ),
      )
      .returning();
    if (!updated) {
      fail("This alert can no longer be stood down.", {
        errorCode: "not_sent",
        statusCode: 409,
      });
    }
    return {
      id: updated.id,
      status: updated.status,
      allClear: true,
      allClearMessage: buildAllClearMessage(owner),
      summary:
        "All-clear recorded (SIMULATED — contacts would get a 'safe now' message; no real message was sent).",
    };
  },
});
