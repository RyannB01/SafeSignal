import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, safesignalContacts } from "../server/db/index.js";
import { ownerOf } from "../server/lib/safesignal-actions.js";
import {
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
  CONTACT_RELATIONSHIP_MAX,
  isValidPhone,
} from "../shared/safesignal.js";

export default defineAction({
  description: "Update one emergency contact (patch: only the fields given change).",
  schema: z.object({
    id: z.string().describe("Contact id"),
    name: z
      .string()
      .min(1)
      .max(CONTACT_NAME_MAX)
      .optional()
      .describe("Contact's full name"),
    phone: z
      .string()
      .min(1)
      .max(CONTACT_PHONE_MAX)
      .refine(isValidPhone, "Enter a valid phone number.")
      .optional()
      .describe("Contact's phone number"),
    relationship: z
      .string()
      .max(CONTACT_RELATIONSHIP_MAX)
      .optional()
      .describe("Relationship label"),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    relationship: z.string(),
  }),
  run: async (args, ctx) => {
    const db = getDb();
    const owner = ownerOf(ctx);
    const [existing] = await db
      .select()
      .from(safesignalContacts)
      .where(
        and(
          eq(safesignalContacts.id, args.id),
          eq(safesignalContacts.ownerEmail, owner),
        ),
      )
      .limit(1);
    if (!existing) {
      fail("Emergency contact not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    const patch: Partial<typeof existing> = {};
    if (args.name !== undefined && !args.name.trim()) {
      fail("Name cannot be empty.", {
        errorCode: "missing_field",
        statusCode: 400,
      });
    }
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.phone !== undefined) patch.phone = args.phone.trim();
    if (args.relationship !== undefined)
      patch.relationship = args.relationship.trim() || "Emergency contact";
    if (Object.keys(patch).length > 0) {
      await db
        .update(safesignalContacts)
        .set(patch)
        .where(
          and(
            eq(safesignalContacts.id, args.id),
            eq(safesignalContacts.ownerEmail, owner),
          ),
        );
    }
    return {
      id: existing.id,
      name: patch.name ?? existing.name,
      phone: patch.phone ?? existing.phone,
      relationship: patch.relationship ?? existing.relationship,
    };
  },
});
