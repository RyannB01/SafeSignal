// SafeSignal shared constants and helpers.
// Pure TypeScript — no dependencies — so both server actions and the React
// UI can import it. Nothing here contacts any real service.

export const SAFESIGNAL_SETTINGS_KEY = "safesignal.settings";

/** Physical phone buttons the user may choose as SOS confirmation. Minimum 2. */
export const PHONE_BUTTON_OPTIONS = [
  "Volume Up",
  "Volume Down",
  "Power",
] as const;

export type PhoneButton = (typeof PHONE_BUTTON_OPTIONS)[number];

/**
 * Named (non-character) keys allowed in a laptop chord. Character keys are
 * any single printable character, normalized to lowercase.
 */
export const NAMED_LAPTOP_KEYS = [
  "Shift",
  "Control",
  "Alt",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Backspace",
  "CapsLock",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Space",
] as const;

/**
 * Normalize a KeyboardEvent.key value into a stored laptop-chord key.
 * Returns null for keys that cannot be part of a chord (Meta, Escape,
 * Tab, function keys, etc.).
 */
export function normalizeLaptopKey(raw: string): string | null {
  if (raw === " ") return "Space";
  if (raw.length === 1) return raw.toLowerCase();
  if (
    (NAMED_LAPTOP_KEYS as readonly string[]).includes(raw)
  ) {
    return raw;
  }
  return null;
}

/** Human-readable label for a stored laptop-chord key. */
export function displayLaptopKey(key: string): string {
  if (key === "Space") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** True when a string is a valid stored laptop-chord key. */
export function isValidLaptopKey(key: string): boolean {
  return normalizeLaptopKey(key) === key;
}

export interface SafeSignalSettings {
  protectionOn: boolean;
  /** Seconds of sustained distress before the check-in fires (5–60). */
  thresholdSeconds: number;
  /** Demo mode drops the effective threshold to 8s so the flow can be shown fast. */
  demoMode: boolean;
  /** If true, no response during the check-in window auto-sends the alert. */
  autoEscalate: boolean;
  /**
   * Physical phone buttons the user chose for SOS confirmation (needs the
   * native app — a web page cannot read volume/power buttons). ALL of them
   * must be pressed together to send. Min 2.
   */
  phoneButtons: PhoneButton[];
  /**
   * Laptop keyboard keys the user chose for SOS confirmation (works in this
   * web demo — the page listens for them held together as a chord). ALL of
   * them must be held together to send. Min 2.
   */
  laptopKeys: string[];
  /**
   * Sound a loud alarm after the SOS is sent. Default OFF — the default is
   * SILENT/stealth so the alert does not draw an aggressor's attention.
   * Only on for cases like a medical emergency alone at home.
   */
  soundAlarm: boolean;
  /**
   * Hold the whole chord for 2s to confirm instead of confirming the moment
   * the chord is complete. Default OFF — instant confirmation is faster in a
   * crisis. On a laptop this means holding all chosen keys together for 2s;
   * on the phone stand-in buttons it means holding each button for 2s.
   */
  holdToConfirm: boolean;
}

export const DEFAULT_SETTINGS: SafeSignalSettings = {
  protectionOn: false,
  thresholdSeconds: 30,
  demoMode: false,
  autoEscalate: false,
  phoneButtons: ["Volume Up", "Power"],
  laptopKeys: ["a", "s"],
  soundAlarm: false,
  holdToConfirm: false,
};

/** Effective threshold in seconds, honouring demo mode. */
export function effectiveThreshold(settings: SafeSignalSettings): number {
  return settings.demoMode ? 8 : settings.thresholdSeconds;
}

/** Distress score 0–100 from face-api.js expression probabilities. */
export function distressScore(expressions: {
  fearful?: number;
  sad?: number;
  angry?: number;
}): number {
  const fearful = expressions.fearful ?? 0;
  const sad = expressions.sad ?? 0;
  const angry = expressions.angry ?? 0;
  return Math.round(100 * (0.5 * fearful + 0.3 * sad + 0.2 * angry));
}

/** A reading counts as "distressed" at this score or above. */
export const DISTRESS_SCORE_CUTOFF = 55;

/** Seconds the user has to answer the "Are you okay?" check-in. */
export const CHECKIN_WINDOW_SECONDS = 30;

/** Seconds after sending during which the SOS can be undone as a mistake. */
export const UNDO_WINDOW_SECONDS = 10;

/** Milliseconds each confirmation button must be held when hold-to-confirm is on. */
export const HOLD_TO_CONFIRM_MS = 2000;

/** Vibration pattern for the check-in prompt. */
export const CHECKIN_HAPTIC: number[] = [400, 200, 400, 200, 800];
/** Distinct vibration pattern meaning "SOS sent". */
export const SENT_HAPTIC: number[] = [200, 100, 200, 100, 600, 100, 600];

/** One recipient's simulated delivery record on a sent alert. */
export interface DeliveryEntry {
  kind: "contact" | "authority";
  name: string;
  phone: string;
  /** ISO timestamp the (simulated) message was sent. */
  sentAt: string;
  /** ISO timestamp the (simulated) delivery was confirmed. */
  deliveredAt: string;
}

/**
 * Build the simulated per-recipient delivery log for a just-sent alert.
 * Both timestamps are part of the simulation — nothing was really sent.
 */
export function buildDeliveryLog(
  recipients: SosRecipient[],
  sentAt: Date,
): DeliveryEntry[] {
  return recipients.map((r) => ({
    kind: r.kind,
    name: r.name,
    phone: r.phone,
    sentAt: sentAt.toISOString(),
    deliveredAt: new Date(sentAt.getTime() + 2000).toISOString(),
  }));
}

/** Quiet "false alarm" message sent (simulated) to contacts when an SOS is undone. */
export function buildFalseAlarmMessage(userName: string): string {
  return (
    `SAFE SIGNAL — FALSE ALARM (SIMULATED).\n` +
    `${userName} pressed SOS by mistake and cancelled it. False alarm — I'm OK. ` +
    `No help is needed. This is a simulated demo message; no real alert was raised.`
  );
}

/** All-clear message sent (simulated) after the undo window closes. */
export function buildAllClearMessage(userName: string): string {
  return (
    `SAFE SIGNAL — ALL CLEAR (SIMULATED).\n` +
    `${userName} is safe now. The earlier SOS is stood down; no help is needed. ` +
    `This is a simulated demo message; no real alert was raised.`
  );
}

export interface SosRecipient {
  kind: "contact" | "authority";
  name: string;
  phone: string;
}

export interface EmergencyContactInput {
  name: string;
  phone: string;
  relationship?: string;
}

/**
 * Loose phone-number check for emergency contacts: only diallable
 * characters, and at least 7 digits so a 2–3 character string cannot pass
 * as a phone number. This is format hygiene, not a guarantee the number
 * is real or reachable — the demo never dials anyone.
 */
export const PHONE_PATTERN = /^[+()\-.\s\d]{7,40}$/;

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && PHONE_PATTERN.test(phone);
}

/** Maximum lengths for contact fields, so oversized input cannot be stored. */
export const CONTACT_NAME_MAX = 100;
export const CONTACT_PHONE_MAX = 40;
export const CONTACT_RELATIONSHIP_MAX = 60;

/**
 * Draft the SOS message. Emergency contacts are the primary recipients and
 * are named first; authorities (112) are listed alongside them. The message
 * always states it is simulated — this demo never raises a real emergency.
 */
export function buildSosMessage(args: {
  userName: string;
  distressScore: number;
  sustainedSeconds: number;
  locationText?: string | null;
  contacts: EmergencyContactInput[];
}): { message: string; recipients: SosRecipient[] } {
  const contacts = args.contacts.map((c) => ({
    kind: "contact" as const,
    name: c.name,
    phone: c.phone,
  }));
  const recipients: SosRecipient[] = [
    ...contacts,
    { kind: "authority", name: "Emergency services (112)", phone: "112" },
  ];
  const contactNames =
    contacts.length > 0
      ? contacts.map((c) => `${c.name} (${c.phone})`).join(", ")
      : "no emergency contacts saved";
  const message =
    `SAFE SIGNAL SOS — SIMULATED DEMO ALERT (no real emergency raised).\n` +
    `${args.userName} may be in distress: a distressed expression was sustained for ` +
    `${args.sustainedSeconds}s (distress score ${args.distressScore}/100) and they confirmed ` +
    `they need help.\n` +
    `Last known location: ${args.locationText ?? "not shared"}.\n` +
    `Please check on them now. Emergency contacts: ${contactNames}. ` +
    `If you cannot reach them, call 112.`;
  return { message, recipients };
}

/** True when every chosen chord input has been pressed/held. */
export function allChordInputsPressed(
  chosen: readonly string[],
  pressed: readonly string[],
): { complete: boolean; missing: string[] } {
  const missing = chosen.filter((b) => !pressed.includes(b));
  return { complete: missing.length === 0, missing };
}
