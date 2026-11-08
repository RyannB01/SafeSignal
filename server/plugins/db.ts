import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "safesignal-contacts-alerts",
      sql: `
        CREATE TABLE IF NOT EXISTS safesignal_contacts (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          relationship TEXT NOT NULL DEFAULT 'Emergency contact',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS safesignal_contacts_owner_idx
          ON safesignal_contacts (owner_email);
        CREATE TABLE IF NOT EXISTS safesignal_alerts (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          message TEXT NOT NULL,
          recipients JSONB NOT NULL,
          delivery JSONB NOT NULL DEFAULT '[]',
          distress_score INTEGER NOT NULL DEFAULT 0,
          sustained_seconds INTEGER NOT NULL DEFAULT 0,
          location_text TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS safesignal_alerts_owner_idx
          ON safesignal_alerts (owner_email, created_at);
      `,
    },
  ],
  { table: "safesignal_migrations" },
);
