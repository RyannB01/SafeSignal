import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, safesignalContacts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";

export default defineAction({
  description: "Remove an emergency contact.",
  schema: z.object({
    id: z.string().describe("Contact id"),
  }),
  outputSchema: z.object({ id: z.string(), removed: z.boolean() }),
  run: async (args, ctx) => {
    const db = getDb();
    const owner = ownerOf(ctx);
    const deleted = await db
      .delete(safesignalContacts)
      .where(
        and(
          eq(safesignalContacts.id, args.id),
          eq(safesignalContacts.ownerEmail, owner),
        ),
      )
      .returning({ id: safesignalContacts.id });
    if (deleted.length === 0) {
      fail("Emergency contact not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    return { id: args.id, removed: true };
  },
});
