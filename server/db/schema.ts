import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

export const safesignalContacts = pgTable(
  "safesignal_contacts",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    relationship: text("relationship").notNull().default("Emergency contact"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("safesignal_contacts_owner_idx").on(t.ownerEmail)],
);

export const safesignalAlerts = pgTable(
  "safesignal_alerts",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    /** draft | sent-simulated | dismissed | cancelled | all-clear */
    status: text("status").notNull().default("draft"),
    message: text("message").notNull(),
    /** [{ kind: "contact" | "authority", name, phone }] */
    recipients: jsonb("recipients").notNull(),
    /** Simulated per-recipient delivery log: [{ kind, name, phone, sentAt, deliveredAt }] */
    delivery: jsonb("delivery").notNull().default([]),
    distressScore: integer("distress_score").notNull().default(0),
    sustainedSeconds: integer("sustained_seconds").notNull().default(0),
    locationText: text("location_text"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("safesignal_alerts_owner_idx").on(t.ownerEmail, t.createdAt)],
);
