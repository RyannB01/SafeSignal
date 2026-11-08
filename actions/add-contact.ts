import { defineAction, fail } from "@agent-native/core/action";
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
  description:
    "Add an emergency contact. Emergency contacts are the primary recipients of a SafeSignal SOS alert.",
  schema: z.object({
    name: z
      .string()
      .min(1)
      .max(CONTACT_NAME_MAX)
      .describe("Contact's full name"),
    phone: z
      .string()
      .min(1)
      .max(CONTACT_PHONE_MAX)
      .refine(isValidPhone, "Enter a valid phone number.")
      .describe("Contact's phone number"),
    relationship: z
      .string()
      .max(CONTACT_RELATIONSHIP_MAX)
      .optional()
      .describe("Relationship, e.g. Mother, Brother, Friend; defaults to Emergency contact"),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    relationship: z.string(),
    sortOrder: z.number(),
    createdAt: z.string(),
  }),
  run: async (args, ctx) => {
    const name = args.name.trim();
    const phone = args.phone.trim();
    if (!name || !phone) {
      fail("Name and phone are both required.", {
        errorCode: "missing_field",
        statusCode: 400,
      });
    }
    const db = getDb();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.insert(safesignalContacts).values({
      id,
      ownerEmail: ownerOf(ctx),
      name,
      phone,
      relationship: args.relationship?.trim() || "Emergency contact",
      sortOrder: 0,
      createdAt,
    });
    return {
      id,
      name,
      phone,
      relationship: args.relationship?.trim() || "Emergency contact",
      sortOrder: 0,
      createdAt,
    };
  },
});
