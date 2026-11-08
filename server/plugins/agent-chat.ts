import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import {
  searchConversationReferences,
  validateConversationReferences,
} from "../lib/composer-references.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "hello",
  "provider-api-request",
  "ask-question",
  "get-settings",
  "update-settings",
  "list-contacts",
  "add-contact",
  "draft-sos-alert",
  "update-sos-draft",
  "confirm-sos-alert",
  "dismiss-check-in",
  "cancel-sos-alert",
  "send-all-clear",
  "list-alerts",
];

export default createAgentChatPlugin({
  appId: "safesignal-agent-native",
  mentionProviders: {
    chats: {
      label: "composerSources.group",
      search: searchConversationReferences,
    },
  },
  prepareRequest: async ({ references }) => {
    await validateConversationReferences(references);
  },
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the SafeSignal agent — the distress-aware SOS app.

SafeSignal watches (with the user's opt-in) for a distressed face, vibrates to check in, and sends a SIMULATED SOS to the user's emergency contacts first and to 112 alongside them — only after the user presses and holds ALL of their chosen physical inputs together as a chord (minimum 2): the phone's volume/power buttons in the native app, or laptop keyboard keys in this web demo. The UI at /safesignal is the product surface; chat is for delegating and reviewing the agent's work.

Use actions as the source of truth. Start by inspecting the current screen when context matters. When the user asks to extend this app, keep the change small and agent-native: add or update actions, expose useful UI, and keep application state/navigation visible to the agent.

Invariants: an SOS only sends from a draft, only when every chosen physical input of the chord was pressed/held together (confirm-sos-alert enforces this, errorCode confirmation_incomplete); sending is simulated only — never contact real authorities or phone numbers; a sent SOS can be cancelled within 10 seconds (cancel-sos-alert) or stood down with an all-clear after that (send-all-clear); default is silent/stealth, no siren unless the user opted into sound-the-alarm.`,
});
