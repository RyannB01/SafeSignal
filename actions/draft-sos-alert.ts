import { defineAction } from "@agent-native/core/action";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  buildSosMessage,
  type SosRecipient,
} from "../shared/safesignal.js";
import { getDb, safesignalAlerts, safesignalContacts } from "../server/db/index.js";
import { ownerOf, readSettings } from "../server/lib/safesignal-actions.js";

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
    "Draft a SafeSignal SOS alert after sustained distress is detected. The agent drafts the message and recipients — emergency contacts first as the primary recipients, alongside emergency services (112) — and the user reviews, edits, and confirms it before anything is sent. Nothing is sent by this action; sending is simulated only after the user presses and holds ALL of their chosen physical inputs together as a chord (phone buttons or laptop keys).",
  schema: z.object({
    distressScore: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("Distress score 0–100 from the on-device face reading"),
    sustainedSeconds: z
      .number()
      .int()
      .min(0)
      .describe("Seconds the distressed expression was sustained"),
    locationText: z
      .string()
      .optional()
      .describe("Human-readable last known location, if the user shared one"),
    userName: z
      .string()
      .optional()
      .describe("Name to use in the alert; defaults to the signed-in user"),
  }),
  outputSchema: alertOutput,
  run: async (args, ctx) => {
    const db = getDb();
    const owner = ownerOf(ctx);
    const contacts = await db
      .select()
      .from(safesignalContacts)
      .where(eq(safesignalContacts.ownerEmail, owner))
      .orderBy(asc(safesignalContacts.sortOrder), asc(safesignalContacts.createdAt))
      .limit(50);
    const { message, recipients } = buildSosMessage({
      userName: args.userName?.trim() || owner,
      distressScore: args.distressScore,
      sustainedSeconds: args.sustainedSeconds,
      locationText: args.locationText?.trim() || null,
      contacts: contacts.map((c) => ({
        name: c.name,
        phone: c.phone,
        relationship: c.relationship,
      })),
    });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(safesignalAlerts).values({
      id,
      ownerEmail: owner,
      status: "draft",
      message,
      recipients: recipients as unknown as Record<string, unknown>[],
      distressScore: args.distressScore,
      sustainedSeconds: args.sustainedSeconds,
      locationText: args.locationText?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      status: "draft",
      message,
      recipients: recipients as SosRecipient[],
      delivery: [],
      distressScore: args.distressScore,
      sustainedSeconds: args.sustainedSeconds,
      locationText: args.locationText?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
  },
});
