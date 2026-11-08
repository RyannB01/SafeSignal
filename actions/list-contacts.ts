import { defineAction } from "@agent-native/core/action";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, safesignalContacts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";

const contactOutput = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  relationship: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
});

export default defineAction({
  description:
    "List the user's emergency contacts — the primary recipients of a SafeSignal SOS alert, shown first and most prominently.",
  readOnly: true,
  schema: z.object({}),
  http: { method: "GET" },
  outputSchema: z.object({ contacts: z.array(contactOutput) }),
  run: async (_args, ctx) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(safesignalContacts)
      .where(eq(safesignalContacts.ownerEmail, ownerOf(ctx)))
      .orderBy(asc(safesignalContacts.sortOrder), asc(safesignalContacts.createdAt))
      .limit(50);
    return {
      contacts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        relationship: r.relationship,
        sortOrder: r.sortOrder,
        createdAt: r.createdAt,
      })),
    };
  },
});
