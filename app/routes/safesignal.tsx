import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconBellRinging,
  IconCheck,
  IconEyeOff,
  IconHistory,
  IconMoon,
  IconPhone,
  IconPlayerPlay,
  IconSettings,
  IconShieldCheck,
  IconUsers,
  IconVideo,
  IconVolume,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CHECKIN_HAPTIC,
  CHECKIN_WINDOW_SECONDS,
  DISTRESS_SCORE_CUTOFF,
  HOLD_TO_CONFIRM_MS,
  PHONE_BUTTON_OPTIONS,
  SENT_HAPTIC,
  UNDO_WINDOW_SECONDS,
  displayLaptopKey,
  distressScore,
  effectiveThreshold,
  normalizeLaptopKey,
  type DeliveryEntry,
  type PhoneButton,
  type SafeSignalSettings,
  type SosRecipient,
} from "../../shared/safesignal.js";

export function meta() {
  return [
    { title: "SafeSignal: distress-aware SOS" },
    {
      name: "description",
      content:
        "Opt-in distress detection: your device checks in when you look distressed, and sends a simulated SOS to your emergency contacts and 112 only when you press and hold the physical buttons or keys you chose together as a chord.",
    },
  ];
}

const FACE_API_CDN =
  "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";

type AlertRow = {
  id: string;
  status: string;
  message: string;
  recipients: SosRecipient[];
  delivery: DeliveryEntry[];
  distressScore: number;
  sustainedSeconds: number;
  locationText: string | null;
  createdAt: string;
  updatedAt: string;
};

function vibrate(pattern: number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration unsupported — the visual prompt is the fallback.
  }
}

function beep(times = 3) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.35;
      osc.start(start);
      osc.stop(start + 0.2);
    }
  } catch {
    // Audio unavailable — the visual prompt is the fallback.
  }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "sent-simulated":
      return <Badge>Sent (simulated)</Badge>;
    case "dismissed":
      return <Badge variant="outline">Dismissed</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled: false alarm</Badge>;
    case "all-clear":
      return <Badge variant="outline">All clear</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function SafeSignalRoute() {
  const settingsQuery = useActionQuery("get-settings", {});
  const contactsQuery = useActionQuery("list-contacts", {});
  const alertsQuery = useActionQuery("list-alerts", {});

  const updateSettings = useActionMutation("update-settings");
  const addContact = useActionMutation("add-contact");
  const removeContact = useActionMutation("remove-contact");
  const draftSos = useActionMutation("draft-sos-alert");
  const updateDraft = useActionMutation("update-sos-draft");
  const confirmSos = useActionMutation("confirm-sos-alert");
  const dismissCheckin = useActionMutation("dismiss-check-in");
  const cancelSos = useActionMutation("cancel-sos-alert");
  const sendAllClear = useActionMutation("send-all-clear");

  const settings = settingsQuery.data as SafeSignalSettings | undefined;
  const contacts = (contactsQuery.data?.contacts ?? []) as {
    id: string;
    name: string;
    phone: string;
    relationship: string;
  }[];
  const alerts = (alertsQuery.data?.alerts ?? []) as AlertRow[];

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sirenRef = useRef<{ stop: () => void } | null>(null);
  const sustainedRef = useRef(0);
  const checkinFiredRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldKeysRef = useRef<Set<string>>(new Set());
  const chordHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chordHoldStartRef = useRef<number | null>(null);

  const [modelsState, setModelsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [cameraState, setCameraState] = useState<
    "off" | "starting" | "on" | "denied"
  >("off");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [sustained, setSustained] = useState(0);
  const [faceSeen, setFaceSeen] = useState(false);
  const [faceBox, setFaceBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [checkinAlert, setCheckinAlert] = useState<AlertRow | null>(null);
  const [checkinSecondsLeft, setCheckinSecondsLeft] = useState(
    CHECKIN_WINDOW_SECONDS,
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [pressedInputs, setPressedInputs] = useState<string[]>([]);
  const [holdingButton, setHoldingButton] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  /** Keys currently held down as part of the laptop chord. */
  const [heldKeys, setHeldKeys] = useState<string[]>([]);
  /** Which device the check-in confirms with — auto-detected, switchable. */
  const [chordMode, setChordMode] = useState<"phone" | "laptop">(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
      ? "phone"
      : "laptop",
  );
  /** Hold-the-chord progress (0–1) while every laptop key is held. */
  const [chordHoldProgress, setChordHoldProgress] = useState(0);
  /** Recording a new laptop chord in Settings. */
  const [recordingChord, setRecordingChord] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [sentAlert, setSentAlert] = useState<AlertRow | null>(null);
  const [showDelivered, setShowDelivered] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(UNDO_WINDOW_SECONDS);
  const [falseAlarmNote, setFalseAlarmNote] = useState<string | null>(null);
  const [allClearNote, setAllClearNote] = useState<string | null>(null);
  const [screenDark, setScreenDark] = useState(false);
  const [sirenOn, setSirenOn] = useState(false);
  const [sosDismissed, setSosDismissed] = useState<Record<string, boolean>>(
    () => {
      try {
        return JSON.parse(
          localStorage.getItem("safesignal-dismissed-screens") ?? "{}",
        ) as Record<string, boolean>;
      } catch {
        return {};
      }
    },
  );
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRelationship, setNewRelationship] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const threshold = settings ? effectiveThreshold(settings) : 30;
  const activeSos =
    sentAlert &&
    ["sent-simulated", "cancelled", "all-clear"].includes(sentAlert.status) &&
    !sosDismissed[sentAlert.id]
      ? sentAlert
      : null;

  // Restore a sent SOS screen after reload: it stays up until dismissed.
  useEffect(() => {
    if (sentAlert) return;
    const latest = alerts.find((a) => a.status === "sent-simulated");
    if (latest && !sosDismissed[latest.id]) {
      setSentAlert(latest);
    }
  }, [alerts, sentAlert, sosDismissed]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraState("off");
    setFaceSeen(false);
    setFaceBox(null);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const loadModels = useCallback(async () => {
    if (modelsState === "ready" || modelsState === "loading") return;
    setModelsState("loading");
    try {
      const w = window as unknown as { faceapi?: any };
      if (!w.faceapi) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = FACE_API_CDN;
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error("Could not load the face-detection library."));
          document.head.appendChild(script);
        });
      }
      const faceapi = (window as unknown as { faceapi: any }).faceapi;
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      await faceapi.nets.faceExpressionNet.loadFromUri("/models");
      setModelsState("ready");
    } catch (err) {
      setModelsState("error");
      setCameraError(
        err instanceof Error ? err.message : "Face-detection models failed to load.",
      );
    }
  }, [modelsState]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("on");
    } catch {
      setCameraState("denied");
      setCameraError(
        "Camera access was denied or unavailable. You can still try the flow with “Simulate distress”.",
      );
    }
  }, []);

  // Turn the camera on/off with the protection toggle.
  useEffect(() => {
    if (!settings) return;
    if (settings.protectionOn) {
      void loadModels();
      if (cameraState === "off") void startCamera();
    } else {
      stopCamera();
      setSimulating(false);
      sustainedRef.current = 0;
      setSustained(0);
      setScore(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.protectionOn]);

  // Detection loop. Simulating bypasses the camera/models entirely.
  const monitoringActive =
    !!settings?.protectionOn &&
    !checkinAlert &&
    !activeSos &&
    (simulating || (cameraState === "on" && modelsState === "ready"));

  useEffect(() => {
    if (!monitoringActive) return;
    const timer = setInterval(() => {
      void (async () => {
        let next = 0;
        if (simulating) {
          next = 88;
          setFaceSeen(true);
        } else {
          const faceapi = (window as unknown as { faceapi?: any }).faceapi;
          const video = videoRef.current;
          if (!faceapi || !video || video.readyState < 2) return;
          try {
            const det = await faceapi
              .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
              .withFaceExpressions();
            if (!det) {
              setFaceSeen(false);
              setFaceBox(null);
              next = 0;
            } else {
              setFaceSeen(true);
              const box = det.detection.box;
              setFaceBox({
                x: (box.x / video.videoWidth) * 100,
                y: (box.y / video.videoHeight) * 100,
                width: (box.width / video.videoWidth) * 100,
                height: (box.height / video.videoHeight) * 100,
              });
              next = distressScore(det.expressions ?? {});
            }
          } catch {
            return;
          }
        }
        setScore(next);
        sustainedRef.current =
          next >= DISTRESS_SCORE_CUTOFF
            ? sustainedRef.current + 0.25
            : Math.max(0, sustainedRef.current - 0.5);
        setSustained(sustainedRef.current);
        if (
          sustainedRef.current >= threshold &&
          !checkinFiredRef.current &&
          !checkinAlert
        ) {
          checkinFiredRef.current = true;
          void triggerCheckin(next, Math.round(sustainedRef.current));
        }
      })();
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitoringActive, threshold, simulating]);

  async function triggerCheckin(scoreNow: number, sustainedNow: number) {
    try {
      const draft = (await draftSos.mutateAsync({
        distressScore: scoreNow,
        sustainedSeconds: sustainedNow,
      })) as AlertRow;
      setCheckinAlert(draft);
      setDraftMessage(draft.message);
      setPressedInputs([]);
      heldKeysRef.current.clear();
      setHeldKeys([]);
      setChordHoldProgress(0);
      setCheckinSecondsLeft(CHECKIN_WINDOW_SECONDS);
      vibrate(CHECKIN_HAPTIC);
      beep(3);
    } catch (err) {
      checkinFiredRef.current = false;
      toast.error(
        actionErrorMessage(err) ?? "Could not start the check-in.",
      );
    }
  }

  // Check-in countdown.
  useEffect(() => {
    if (!checkinAlert) return;
    if (checkinSecondsLeft <= 0) {
      if (settings?.autoEscalate) {
        void confirmAll();
      } else {
        void (async () => {
          try {
            await dismissCheckin.mutateAsync({ id: checkinAlert.id });
          } catch {
            // Already resolved; nothing to do.
          }
          setCheckinAlert(null);
          checkinFiredRef.current = false;
          sustainedRef.current = 0;
          setSustained(0);
          toast("Check-in expired. No answer, so nothing was sent.");
        })();
      }
      return;
    }
    const timer = setTimeout(
      () => setCheckinSecondsLeft((s) => s - 1),
      1000,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkinAlert, checkinSecondsLeft]);

  async function confirmAll() {
    if (!checkinAlert || !settings) return;
    const chord =
      chordMode === "phone" ? settings.phoneButtons : settings.laptopKeys;
    try {
      const result = (await confirmSos.mutateAsync({
        id: checkinAlert.id,
        inputKind: chordMode,
        pressedInputs: [...chord],
      })) as AlertRow;
      onSosSent(result);
    } catch (err) {
      toast.error(
        actionErrorMessage(err) ?? "Could not send the SOS.",
      );
    }
  }

  /** Send the SOS with the currently held laptop chord. */
  async function confirmChord(held: string[]) {
    if (!checkinAlert || !settings) return;
    try {
      const result = (await confirmSos.mutateAsync({
        id: checkinAlert.id,
        inputKind: "laptop",
        pressedInputs: held,
      })) as AlertRow;
      onSosSent(result);
    } catch (err) {
      toast.error(actionErrorMessage(err) ?? "Could not send the SOS.");
    }
  }

  // Clear chord state whenever the check-in closes.
  useEffect(() => {
    if (!checkinAlert) {
      heldKeysRef.current.clear();
      setHeldKeys([]);
      setChordHoldProgress(0);
      setPressedInputs([]);
    }
  }, [checkinAlert]);

  // Listen for the laptop chord while the check-in is open.
  useEffect(() => {
    if (!checkinAlert || chordMode !== "laptop") return;
    const down = (e: KeyboardEvent) => {
      if (!settings) return;
      const key = normalizeLaptopKey(e.key);
      if (!key || !settings.laptopKeys.includes(key)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (heldKeysRef.current.has(key)) return;
      heldKeysRef.current.add(key);
      setHeldKeys([...heldKeysRef.current]);
    };
    const up = (e: KeyboardEvent) => {
      const key = normalizeLaptopKey(e.key);
      if (!key) return;
      if (heldKeysRef.current.delete(key)) {
        setHeldKeys([...heldKeysRef.current]);
      }
    };
    const blur = () => {
      heldKeysRef.current.clear();
      setHeldKeys([]);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      heldKeysRef.current.clear();
      setHeldKeys([]);
    };
  }, [checkinAlert, chordMode, settings]);

  // When the full laptop chord is held, confirm — immediately, or after a
  // 2s hold when hold-the-chord is on.
  useEffect(() => {
    if (!checkinAlert || !settings || chordMode !== "laptop") return;
    const complete = settings.laptopKeys.every((k) => heldKeys.includes(k));
    if (!complete) {
      chordHoldStartRef.current = null;
      setChordHoldProgress(0);
      return;
    }
    if (!settings.holdToConfirm) {
      void confirmChord(heldKeys);
      return;
    }
    if (chordHoldStartRef.current === null) {
      chordHoldStartRef.current = Date.now();
    }
    const timer = setInterval(() => {
      const elapsed = Date.now() - (chordHoldStartRef.current ?? Date.now());
      setChordHoldProgress(Math.min(1, elapsed / HOLD_TO_CONFIRM_MS));
      if (elapsed >= HOLD_TO_CONFIRM_MS) {
        clearInterval(timer);
        chordHoldStartRef.current = null;
        setChordHoldProgress(0);
        void confirmChord(heldKeys);
      }
    }, 50);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldKeys, checkinAlert, settings, chordMode]);

  // Record a laptop chord in Settings: capture keys while recording.
  useEffect(() => {
    if (!recordingChord) return;
    const down = (e: KeyboardEvent) => {
      const key = normalizeLaptopKey(e.key);
      if (!key) return;
      e.preventDefault();
      if (e.repeat) return;
      setRecordedKeys((prev) =>
        prev.includes(key) ? prev : [...prev, key],
      );
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [recordingChord]);

  function onSosSent(result: AlertRow) {
    setSentAlert(result);
    setCheckinAlert(null);
    setShowDelivered(false);
    setUndoSecondsLeft(UNDO_WINDOW_SECONDS);
    setFalseAlarmNote(null);
    setAllClearNote(null);
    vibrate(SENT_HAPTIC);
    if (settings?.soundAlarm) startSiren();
    setTimeout(() => setShowDelivered(true), 2000);
    setSimulating(false);
    sustainedRef.current = 0;
    setSustained(0);
  }

  // Undo countdown on the SOS screen.
  useEffect(() => {
    if (!activeSos) return;
    if (undoSecondsLeft <= 0) return;
    const timer = setTimeout(
      () => setUndoSecondsLeft((s) => s - 1),
      1000,
    );
    return () => clearTimeout(timer);
  }, [activeSos, undoSecondsLeft]);

  function startSiren() {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 660;
      gain.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      lfo.start();
      sirenRef.current = {
        stop: () => {
          try {
            osc.stop();
            lfo.stop();
            void ctx.close();
          } catch {
            // Already stopped.
          }
        },
      };
      setSirenOn(true);
    } catch {
      // Audio unavailable.
    }
  }

  function stopSiren() {
    sirenRef.current?.stop();
    sirenRef.current = null;
    setSirenOn(false);
  }

  /** Tap an on-screen stand-in for a chosen phone button. */
  async function pressButton(label: string) {
    if (!settings || !checkinAlert) return;
    if (pressedInputs.includes(label)) return;
    const next = [...pressedInputs, label];
    setPressedInputs(next);
    if (next.length >= settings.phoneButtons.length) {
      const missing = settings.phoneButtons.filter((b) => !next.includes(b));
      if (missing.length > 0) return;
      try {
        const result = (await confirmSos.mutateAsync({
          id: checkinAlert.id,
          inputKind: "phone",
          pressedInputs: next,
        })) as AlertRow;
        onSosSent(result);
      } catch (err) {
        toast.error(actionErrorMessage(err) ?? "Could not send the SOS.");
      }
    }
  }

  function holdStart(label: string) {
    if (!settings?.holdToConfirm) {
      void pressButton(label);
      return;
    }
    if (pressedInputs.includes(label)) return;
    setHoldingButton(label);
    setHoldProgress(0);
    const started = Date.now();
    const tick = () => {
      const elapsed = Date.now() - started;
      setHoldProgress(Math.min(1, elapsed / HOLD_TO_CONFIRM_MS));
      if (elapsed >= HOLD_TO_CONFIRM_MS) {
        setHoldingButton(null);
        setHoldProgress(0);
        void pressButton(label);
      } else {
        holdTimerRef.current = setTimeout(tick, 50);
      }
    };
    holdTimerRef.current = setTimeout(tick, 50);
  }

  function holdCancel() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    setHoldingButton(null);
    setHoldProgress(0);
  }

  async function saveSettings(patch: Partial<SafeSignalSettings>) {
    setSettingsError(null);
    try {
      await updateSettings.mutateAsync(patch);
    } catch (err) {
      const message = actionErrorMessage(err) ?? "Could not save settings.";
      setSettingsError(message);
      toast.error(message);
    }
  }

  function togglePhoneButton(label: PhoneButton) {
    if (!settings) return;
    const chosen = settings.phoneButtons.includes(label)
      ? settings.phoneButtons.filter((b) => b !== label)
      : [...settings.phoneButtons, label];
    if (chosen.length < 2) {
      setSettingsError(
        "At least 2 phone buttons are required. All chosen buttons must be pressed together to send an SOS.",
      );
      return;
    }
    void saveSettings({ phoneButtons: chosen });
  }

  async function dismissSosScreen() {
    if (!sentAlert) return;
    stopSiren();
    const next = { ...sosDismissed, [sentAlert.id]: true };
    setSosDismissed(next);
    try {
      localStorage.setItem(
        "safesignal-dismissed-screens",
        JSON.stringify(next),
      );
    } catch {
      // Storage unavailable — the screen will reappear on reload.
    }
    setSentAlert(null);
    checkinFiredRef.current = false;
  }

  const loading = settingsQuery.isPending || contactsQuery.isPending;

  return (
    <div className="safesignal-page mx-auto max-w-3xl space-y-6 overflow-x-clip px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          <Link
            to="/safesignal"
            className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconShieldCheck className="size-6" /> SafeSignal
          </Link>
        </h1>
        <p className="text-muted-foreground text-sm">
          Opt-in distress detection. Your device checks in when you look
          distressed, and only sends an SOS when you press and hold the
          physical buttons or keys you chose together as a chord.
        </p>
      </header>

      <Alert>
        <IconAlertTriangle className="size-4" />
        <AlertTitle>Honest limit: this is a web demo, not the real product</AlertTitle>
        <AlertDescription>
          This page only watches while it is open in your browser. In a real
          crisis nobody opens a web page. The real SafeSignal would be an
          installed app / background service that runs without opening
          anything. This demo shows the flow only. Every alert it sends
          is simulated; no real message ever goes to your contacts or to 112.
          One more honest limit: a web page cannot read a phone’s volume or
          power buttons (browsers don’t expose them), so on a phone this demo
          uses on-screen stand-in buttons. The native app would listen for
          the real hardware buttons (volume keys are interceptable on
          Android; the power button is restricted, so the design leans on
          volume keys plus a long-press pattern).
        </AlertDescription>
      </Alert>

      {loading || !settings ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <IconVideo className="size-5" /> Monitor
                </span>
                <span className="flex items-center gap-2 text-sm font-normal">
                  Protection
                  <Switch
                    checked={settings.protectionOn}
                    onCheckedChange={(v) => void saveSettings({ protectionOn: v })}
                    aria-label="Protection on or off"
                  />
                  {settings.protectionOn ? (
                    <Badge>On</Badge>
                  ) : (
                    <Badge variant="outline">Off</Badge>
                  )}
                </span>
              </CardTitle>
              <CardDescription>
                {settings.protectionOn
                  ? `Watching for a distressed face. Sustained distress for ${threshold}s triggers a check-in.`
                  : "Protection is off. Nothing is watching your camera."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                />
                {faceSeen && faceBox && (
                  <div
                    className="absolute rounded-md border-2 border-red-500"
                    style={{
                      left: `${faceBox.x}%`,
                      top: `${faceBox.y}%`,
                      width: `${faceBox.width}%`,
                      height: `${faceBox.height}%`,
                    }}
                  />
                )}
                {cameraState !== "on" && !simulating && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white">
                    <IconVideo className="size-8 opacity-70" />
                    <p className="text-sm opacity-80">
                      {settings.protectionOn
                        ? "Camera is starting…"
                        : "Turn protection on to start the camera."}
                    </p>
                  </div>
                )}
                {simulating && (
                  <div className="absolute left-2 top-2">
                    <Badge>Simulating distress</Badge>
                  </div>
                )}
              </div>

              {cameraError && (
                <Alert variant="destructive">
                  <AlertDescription>{cameraError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Distress level</span>
                  <span className="font-medium">
                    {score}/100 {faceSeen ? "· face detected" : "· no face"}
                  </span>
                </div>
                <Progress value={score} />
                <div className="flex justify-between text-sm">
                  <span>
                    Sustained distress: {Math.floor(sustained)}s / {threshold}s
                  </span>
                  <span>
                    {modelsState === "ready"
                      ? "Detector ready"
                      : modelsState === "loading"
                        ? "Loading detector…"
                        : modelsState === "error"
                          ? "Detector failed to load"
                          : "Detector idle"}
                  </span>
                </div>
                <Progress value={Math.min(100, (sustained / threshold) * 100)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!settings.protectionOn}
                  onClick={() => setSimulating((s) => !s)}
                >
                  <IconPlayerPlay className="size-4" />
                  {simulating ? "Stop simulating distress" : "Simulate distress"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!settings.protectionOn}
                  onClick={() => {
                    sustainedRef.current = 0;
                    setSustained(0);
                    setScore(0);
                  }}
                >
                  Reset timer
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Detection runs entirely on your device. No video is uploaded
                or stored. “Simulate distress” feeds a fake distress signal so
                you can walk the whole flow without faking a face on camera.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IconSettings className="size-5" /> Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {settingsError && (
                <Alert variant="destructive">
                  <AlertDescription>{settingsError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>
                  Distress threshold: {settings.thresholdSeconds}s
                  {settings.demoMode && " (demo mode: 8s applies)"}
                </Label>
                <input
                  type="range"
                  min={5}
                  max={60}
                  value={settings.thresholdSeconds}
                  onChange={(e) =>
                    void saveSettings({
                      thresholdSeconds: Number(e.target.value),
                    })
                  }
                  className="w-full"
                  aria-label="Distress threshold in seconds"
                />
                <p className="text-muted-foreground text-xs">
                  Seconds of sustained distress before the check-in fires.
                </p>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Demo mode</Label>
                  <p className="text-muted-foreground text-xs">
                    Drops the threshold to 8 seconds so the flow can be shown
                    quickly.
                  </p>
                </div>
                <Switch
                  checked={settings.demoMode}
                  onCheckedChange={(v) => void saveSettings({ demoMode: v })}
                  aria-label="Demo mode"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Auto-escalate if no answer</Label>
                  <p className="text-muted-foreground text-xs">
                    If you don’t answer the check-in, send the SOS anyway.
                    Off by default.
                  </p>
                </div>
                <Switch
                  checked={settings.autoEscalate}
                  onCheckedChange={(v) =>
                    void saveSettings({ autoEscalate: v })
                  }
                  aria-label="Auto-escalate if no answer"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="flex items-center gap-2">
                    <IconVolume className="size-4" /> Sound the alarm after SOS
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Off by default. Silent/stealth, so an aggressor is not
                    alerted. Turn on only for cases like a medical emergency
                    alone at home.
                  </p>
                </div>
                <Switch
                  checked={settings.soundAlarm}
                  onCheckedChange={(v) => void saveSettings({ soundAlarm: v })}
                  aria-label="Sound the alarm after SOS"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Hold the chord for 2 seconds</Label>
                  <p className="text-muted-foreground text-xs">
                    Hold the whole chord for 2 seconds to confirm instead of
                    confirming the moment it is complete. Off by default.
                    instant confirmation is faster in a crisis. On a laptop
                    this means holding all chosen keys together; on the phone
                    stand-in buttons it means holding each button for 2s.
                  </p>
                </div>
                <Switch
                  checked={settings.holdToConfirm}
                  onCheckedChange={(v) =>
                    void saveSettings({ holdToConfirm: v })
                  }
                  aria-label="Hold the chord for 2 seconds"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Phone buttons: choose 2 or more. ALL of them must be
                  pressed together to send.
                </Label>
                <p className="text-muted-foreground text-xs">
                  For the real native app. A web page cannot read your
                  phone’s volume or power buttons, so in this demo the
                  on-screen buttons below stand in for them.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PHONE_BUTTON_OPTIONS.map((label) => (
                    <label
                      key={label}
                      className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={settings.phoneButtons.includes(label)}
                        onCheckedChange={() => togglePhoneButton(label)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>
                  Laptop keys: choose 2 or more. Hold them ALL together as
                  a chord to send.
                </Label>
                <p className="text-muted-foreground text-xs">
                  Works in this demo: the page listens for the keys you hold
                  down. Record a chord, or type keys separated by spaces.
                </p>
                <div className="flex flex-wrap gap-2">
                  {settings.laptopKeys.map((key) => (
                    <span
                      key={key}
                      className="rounded-md border bg-muted px-3 py-2 font-mono text-sm"
                    >
                      {displayLaptopKey(key)}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRecordedKeys([]);
                      setRecordingChord((r) => !r);
                    }}
                  >
                    {recordingChord
                      ? "Stop recording"
                      : "Record chord: hold keys together"}
                  </Button>
                  {recordingChord && (
                    <>
                      <span className="self-center text-sm">
                        {recordedKeys.length === 0
                          ? "Hold 2 or more keys together…"
                          : `Captured: ${recordedKeys.map(displayLaptopKey).join(" + ")}`}
                      </span>
                      <Button
                        size="sm"
                        disabled={recordedKeys.length < 2}
                        onClick={() => {
                          void saveSettings({ laptopKeys: recordedKeys });
                          setRecordingChord(false);
                          setRecordedKeys([]);
                        }}
                      >
                        Save chord
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRecordedKeys([])}
                      >
                        Clear
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IconUsers className="size-5" /> Emergency contacts
              </CardTitle>
              <CardDescription>
                The primary recipients of an SOS. They are contacted first,
                before authorities, and shown first on the SOS screen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {contacts.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No emergency contacts yet. Add at least one. Without them,
                  only 112 is on the recipient list.
                </p>
              )}
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div>
                    <p className="font-medium">
                      {c.name}{" "}
                      <span className="text-muted-foreground text-sm">
                        · {c.relationship}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-sm flex items-center gap-1">
                      <IconPhone className="size-3" />
                      <a
                        className="underline-offset-2 hover:underline"
                        href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                      >
                        {c.phone}
                      </a>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void removeContact
                        .mutateAsync({ id: c.id })
                        .catch((err: unknown) =>
                          toast.error(
                            actionErrorMessage(err) ??
                              "Could not remove the contact.",
                          ),
                        );
                    }}
                  >
                    <IconX className="size-4" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-32 flex-1 space-y-1">
                  <Label htmlFor="new-contact-name">Name</Label>
                  <Input
                    id="new-contact-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="min-w-32 flex-1 space-y-1">
                  <Label htmlFor="new-contact-phone">Phone</Label>
                  <Input
                    id="new-contact-phone"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </div>
                <div className="min-w-32 flex-1 space-y-1">
                  <Label htmlFor="new-contact-relationship">
                    Relationship (optional)
                  </Label>
                  <Input
                    id="new-contact-relationship"
                    value={newRelationship}
                    onChange={(e) => setNewRelationship(e.target.value)}
                    className="w-full"
                  />
                </div>
                <Button
                  disabled={!newName.trim() || !newPhone.trim()}
                  onClick={() => {
                    void addContact
                      .mutateAsync({
                        name: newName.trim(),
                        phone: newPhone.trim(),
                        relationship: newRelationship.trim() || undefined,
                      })
                      .then(() => {
                        setNewName("");
                        setNewPhone("");
                        setNewRelationship("");
                      })
                      .catch((err: unknown) =>
                        toast.error(
                          actionErrorMessage(err) ??
                            "Could not add the contact.",
                        ),
                      );
                  }}
                >
                  Add contact
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IconHistory className="size-5" /> Alert history
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No alerts yet. Drafts, sent alerts, dismissals, cancellations
                  and all-clears appear here.
                </p>
              )}
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{a.message.split("\n")[0]}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatTime(a.createdAt)} · score {a.distressScore} ·
                      sustained {a.sustainedSeconds}s
                    </p>
                  </div>
                  {statusBadge(a.status)}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <strong>1. Watch.</strong> With protection on, your camera is
                read on-device for a distressed expression. Nothing leaves
                your device.
              </p>
              <p>
                <strong>2. Check in.</strong> Sustained distress vibrates your
                device and asks “Are you okay?”, so a hard stare or an
                emotional video doesn’t trigger an alert.
              </p>
              <p>
                <strong>3. Confirm.</strong> The agent drafts the SOS (message,
                recipients, location). You can edit it, then press and hold{" "}
                <strong>every</strong> physical button or key you chose together as a
                chord: your phone’s volume/power buttons in the native app, or
                your laptop keys in this demo.
              </p>
              <p>
                <strong>4. Help is on the way.</strong> Your emergency contacts
                hear first, then 112. The screen stays up, stays silent by
                default, and can go dark. A mistake can be undone for 10
                seconds; after that you can send an all-clear.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {checkinAlert && settings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <IconBellRinging className="size-6" /> Are you okay?
              </CardTitle>
              <CardDescription>
                Distress was sustained for {checkinAlert.sustainedSeconds}s
                (score {checkinAlert.distressScore}/100). Answer within{" "}
                {checkinSecondsLeft}s or the check-in expires
                {settings.autoEscalate
                  ? " and the SOS sends automatically"
                  : " with nothing sent"}
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>The agent drafted this SOS. Review and edit it</Label>
                <Textarea
                  value={draftMessage}
                  onChange={(e) => setDraftMessage(e.target.value)}
                  rows={6}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void updateDraft
                      .mutateAsync({
                        id: checkinAlert.id,
                        message: draftMessage,
                      })
                      .then(() => toast("Draft updated."))
                      .catch((err: unknown) =>
                        toast.error(
                          actionErrorMessage(err) ?? "Could not update the draft.",
                        ),
                      );
                  }}
                >
                  Save draft changes
                </Button>
              </div>
              <div className="space-y-2">
                <Label>Will go to (contacts first)</Label>
                {checkinAlert.recipients.map((r) => (
                  <p key={`${r.kind}-${r.phone}`} className="text-sm">
                    {r.kind === "authority" ? "112 · " : "Contact · "}
                    {r.name} ·{" "}
                    <a
                      className="underline-offset-2 hover:underline"
                      href={`tel:${r.phone.replace(/[^+\d]/g, "")}`}
                    >
                      {r.phone}
                    </a>
                  </p>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>
                    {chordMode === "laptop"
                      ? `Hold ALL ${settings.laptopKeys.length} keys together to send the SOS`
                      : `Press ALL ${settings.phoneButtons.length} phone buttons to send the SOS`}
                    {settings.holdToConfirm ? " (hold the chord for 2s)" : ""}
                  </Label>
                  <div className="flex gap-1">
                    <Button
                      variant={chordMode === "phone" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setChordMode("phone")}
                    >
                      Phone
                    </Button>
                    <Button
                      variant={chordMode === "laptop" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setChordMode("laptop")}
                    >
                      Laptop
                    </Button>
                  </div>
                </div>
                {chordMode === "laptop" ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {settings.laptopKeys.map((key) => {
                        const held = heldKeys.includes(key);
                        return (
                          <span
                            key={key}
                            className={`rounded-md border px-4 py-3 font-mono text-base font-semibold ${
                              held
                                ? "border-green-500 bg-green-500/20 text-green-700 dark:text-green-300"
                                : "bg-muted"
                            }`}
                          >
                            {held && "✓ "}
                            {displayLaptopKey(key)}
                          </span>
                        );
                      })}
                    </div>
                    {settings.holdToConfirm && chordHoldProgress > 0 && (
                      <Progress value={chordHoldProgress * 100} />
                    )}
                    <p className="text-muted-foreground text-xs">
                      {heldKeys.length}/{settings.laptopKeys.length} keys held. Hold them all together. The SOS only sends when the
                      whole chord is held.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground text-xs">
                      On-screen stand-in. The real app would use your{" "}
                      {settings.phoneButtons.join(" + ")} buttons. A web page
                      cannot read a phone’s hardware buttons.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {settings.phoneButtons.map((label) => {
                        const pressed = pressedInputs.includes(label);
                        const holding = holdingButton === label;
                        return (
                          <Button
                            key={label}
                            variant={pressed ? "default" : "destructive"}
                            className="relative h-12 overflow-hidden"
                            disabled={pressed}
                            onPointerDown={() => holdStart(label)}
                            onPointerUp={holdCancel}
                            onPointerLeave={holdCancel}
                            onContextMenu={(e) => e.preventDefault()}
                          >
                            {holding && (
                              <span
                                className="absolute inset-y-0 left-0 bg-white/30"
                                style={{ width: `${holdProgress * 100}%` }}
                              />
                            )}
                            <span className="relative flex items-center gap-2">
                              {pressed && <IconCheck className="size-4" />}
                              {label}
                              {holding ? " (hold…)" : ""}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {pressedInputs.length}/{settings.phoneButtons.length}{" "}
                      pressed. The SOS only sends when all are pressed.
                    </p>
                  </>
                )}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  void dismissCheckin
                    .mutateAsync({ id: checkinAlert.id })
                    .then(() => {
                      setCheckinAlert(null);
                      checkinFiredRef.current = false;
                      sustainedRef.current = 0;
                      setSustained(0);
                      toast("You’re OK. Check-in dismissed, nothing sent.");
                    })
                    .catch((err: unknown) =>
                      toast.error(
                        actionErrorMessage(err) ?? "Could not dismiss.",
                      ),
                    );
                }}
              >
                I’m OK. Dismiss
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeSos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <IconShieldCheck className="size-6" /> Help is on the way
              </CardTitle>
              <CardDescription>
                SOS sent {formatTime(activeSos.updatedAt)}. SIMULATED. No
                real message was sent to anyone. This screen stays up until
                you dismiss it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Delivery status (simulated)</Label>
                {activeSos.delivery.length === 0 &&
                  activeSos.recipients.map((r) => (
                    <p key={`${r.kind}-${r.phone}`} className="text-sm">
                      {r.kind === "authority" ? "112 · " : "Contact · "}
                      {r.name} ·{" "}
                      <a
                        className="underline-offset-2 hover:underline"
                        href={`tel:${r.phone.replace(/[^+\d]/g, "")}`}
                      >
                        {r.phone}
                      </a>
                    </p>
                  ))}
                {activeSos.delivery.map((d) => (
                  <div
                    key={`${d.kind}-${d.phone}`}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    <p className="font-medium">
                      {d.kind === "authority" ? "112 · " : "Contact · "}
                      {d.name} ·{" "}
                      <a
                        className="underline-offset-2 hover:underline"
                        href={`tel:${d.phone.replace(/[^+\d]/g, "")}`}
                      >
                        {d.phone}
                      </a>
                    </p>
                    <p className="text-muted-foreground">
                      Sent ✓ {formatTime(d.sentAt)}
                      {showDelivered && (
                        <> · Delivered ✓ {formatTime(d.deliveredAt)}</>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              {undoSecondsLeft > 0 && sentAlert?.status === "sent-simulated" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Undo window: {undoSecondsLeft}s left
                  </p>
                  <Button
                    variant="destructive"
                    className="h-14 w-full text-base"
                    onClick={() => {
                      void cancelSos
                        .mutateAsync({ id: activeSos.id })
                        .then((res) => {
                          setFalseAlarmNote(
                            (res as { falseAlarmMessage: string })
                              .falseAlarmMessage,
                          );
                          setSentAlert((prev) =>
                            prev ? { ...prev, status: "cancelled" } : prev,
                          );
                        })
                        .catch((err: unknown) =>
                          toast.error(
                            actionErrorMessage(err) ??
                              "Could not cancel the SOS.",
                          ),
                        );
                    }}
                  >
                    Cancel: it was a mistake
                  </Button>
                </div>
              )}

              {undoSecondsLeft <= 0 &&
                sentAlert?.status === "sent-simulated" && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      void sendAllClear
                        .mutateAsync({ id: activeSos.id })
                        .then((res) => {
                          setAllClearNote(
                            (res as { allClearMessage: string }).allClearMessage,
                          );
                          setSentAlert((prev) =>
                            prev ? { ...prev, status: "all-clear" } : prev,
                          );
                        })
                        .catch((err: unknown) =>
                          toast.error(
                            actionErrorMessage(err) ??
                              "Could not send the all-clear.",
                          ),
                        );
                    }}
                  >
                    Send all-clear: I’m safe now
                  </Button>
                )}

              {falseAlarmNote && (
                <Alert>
                  <AlertTitle>Cancelled: false alarm</AlertTitle>
                  <AlertDescription className="whitespace-pre-line text-xs">
                    {falseAlarmNote}
                  </AlertDescription>
                </Alert>
              )}
              {allClearNote && (
                <Alert>
                  <AlertTitle>All clear sent</AlertTitle>
                  <AlertDescription className="whitespace-pre-line text-xs">
                    {allClearNote}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setScreenDark(true)}
                >
                  <IconMoon className="size-4" /> Make screen dark
                </Button>
                {sirenOn && (
                  <Button variant="outline" onClick={stopSiren}>
                    <IconVolumeOff className="size-4" /> Stop alarm
                  </Button>
                )}
                <Button variant="outline" onClick={() => void dismissSosScreen()}>
                  <IconX className="size-4" /> Dismiss this screen
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Silent by default. No siren, no sound. The dark screen makes
                the phone look locked.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {screenDark && (
        <button
          type="button"
          aria-label="Show SafeSignal again"
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black pb-8 text-neutral-700"
          onClick={() => setScreenDark(false)}
        >
          <span className="flex items-center gap-2 text-xs">
            <IconEyeOff className="size-3" /> SafeSignal is running · tap to
            show
          </span>
        </button>
      )}
    </div>
  );
}
