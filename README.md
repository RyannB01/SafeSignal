# SafeSignal — distress-aware SOS (Agent-Native Hackathon)

Opt-in safety app: the webcam watches for a distressed face; sustained distress triggers a vibrating "Are you okay?" check-in; pressing and holding ALL of the physical buttons or keys you chose together as a chord (minimum 2) sends a **simulated** SOS to your emergency contacts first, then 112. Nothing real is ever sent.

## Run it

```bash
git clone https://github.com/RyannB01/SafeSignal.git
cd SafeSignal
pnpm --config.manage-package-manager-versions=false exec agent-native dev --port 8123
```

Then open http://localhost:8123/safesignal (sign in with the local dev account if asked).

Notes:

- Face detection uses face-api.js from the jsDelivr CDN plus model weights in `public/models/` (tiny_face_detector + face_expression_net).
- The agent chat needs an LLM key to reason (Ollama local is supported); the monitor/draft/confirm flow works with no key.

## What it does

- Monitor: on-device face-expression distress score (fear 50% / sad 30% / angry 20%), sustained-threshold check-in (default 30s, demo mode 8s), "Simulate distress" button for a fast demo.
- Check-in: vibration + tone, 30s window, agent-drafted SOS editable in the modal, physical-chord confirmation — laptop keys held together (live in this demo), phone volume/power buttons in the native app (on-screen stand-in buttons here, since a web page cannot read hardware buttons); hold-the-chord 2s if enabled.
- After SOS: "Help is on the way" screen with per-recipient simulated delivery status (contacts first, then 112), a distinct "sent" vibration, silent/stealth by default with a dark-screen option, an opt-in alarm (default off), a 10-second undo window ("Cancel — it was a mistake", contacts get a quiet false-alarm message), then a "Send all-clear" button.
- Settings: threshold 5–60s, demo mode, auto-escalate, phone-button picker and laptop-key chord recorder (2 or more each), sound-the-alarm, hold-the-chord, emergency contacts, alert history.

## Honest limit (shown in the app)

This web page only watches while it is open. In a real crisis nobody opens a web page — the real SafeSignal would be an installed app / background service. The demo shows the flow only, and every alert is simulated. A web page also cannot read a phone's volume or power buttons — the native app would listen for the real hardware buttons (volume keys are interceptable on Android; the power button is restricted, so the design leans on volume keys plus a long-press pattern).

## Actions (Agent-Native `defineAction`)

get-settings, update-settings, list/add/update/remove-contact, draft-sos-alert, update-sos-draft, confirm-sos-alert, dismiss-check-in, cancel-sos-alert, send-all-clear, list-alerts, get-alert.

## Verify

```bash
pnpm --config.manage-package-manager-versions=false typecheck
pnpm --config.manage-package-manager-versions=false agent-native:doctor
pnpm --config.manage-package-manager-versions=false action get-settings
```

## Submission

Submitted 8 November 2026 to the Agent-Native Hackathon (Builder.io). Demo clip: https://clips.agent-native.com/share/4W424R09j9j5
