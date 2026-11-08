import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  allChordInputsPressed,
  buildDeliveryLog,
  type DeliveryEntry,
  type SosRecipient,
} from "../shared/safesignal.js";
import { getDb, safesignalAlerts } from "../server/db/index.js";
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
  simulated: z.boolean(),
  summary: z.string(),
});

export default defineAction({
  description:
    "Confirm and send a draft SOS alert. The caller must pass EVERY physical input of the chord the user chose in Settings (minimum 2) — the phone buttons (Volume Up / Volume Down / Power) when inputKind is 'phone', or the laptop keys when inputKind is 'laptop'; if any is missing the alert is NOT sent. Sending is simulated only — the alert is recorded as sent-simulated and no real message goes to any authority or phone number.",
  schema: z.object({
    id: z.string().describe("Draft alert id"),
    inputKind: z
      .enum(["phone", "laptop"])
      .describe(
        "Which device the confirmation came from: 'phone' checks the chosen phone buttons, 'laptop' checks the chosen laptop keys",
      ),
    pressedInputs: z
      .array(z.string())
      .describe(
        "Physical inputs pressed/held together as a chord; must include ALL inputs chosen in Settings for that device",
      ),
  }),
  outputSchema: alertOutput,
  run: async (args, ctx) => {
    const db = getDb();
    const owner = ownerOf(ctx);
    const settings = await readSettings();
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
      fail(`This alert is ${existing.status} and can no longer be sent.`, {
        errorCode: "not_draft",
        statusCode: 409,
      });
    }
    const chosenChord =
      args.inputKind === "phone" ? settings.phoneButtons : settings.laptopKeys;
    const check = allChordInputsPressed(chosenChord, args.pressedInputs);
    if (!check.complete) {
      fail(
        `SOS not sent: these ${args.inputKind === "phone" ? "phone buttons" : "laptop keys"} were not pressed: ${check.missing.join(", ")}. All ${chosenChord.length} chosen inputs must be held together as a chord.`,
        {
          errorCode: "confirmation_incomplete",
          statusCode: 409,
          details: { missing: check.missing },
        },
      );
    }
    const now = new Date().toISOString();
    const delivery: DeliveryEntry[] = buildDeliveryLog(
      existing.recipients as unknown as SosRecipient[],
      new Date(now),
    );
    const [updated] = await db
      .update(safesignalAlerts)
      .set({
        status: "sent-simulated",
        updatedAt: now,
        delivery: delivery as unknown as Record<string, unknown>[],
      })
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
    return {
      id: updated.id,
      status: updated.status,
      message: updated.message,
      recipients: updated.recipients as unknown as SosRecipient[],
      delivery: updated.delivery as unknown as DeliveryEntry[],
      distressScore: updated.distressScore,
      sustainedSeconds: updated.sustainedSeconds,
      locationText: updated.locationText,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      simulated: true,
      summary:
        "SOS alert recorded as sent (SIMULATED — no real message was sent to any authority or phone number).",
    };
  },
});
