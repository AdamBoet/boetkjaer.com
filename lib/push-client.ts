// Browser side of Web Push: registers /sw.js, asks for permission and
// stores the subscription via /api/push-subscribe (see lib/push.ts for
// sending). Shared by the Mandarin and Habit Helper pages.
//
// Two iOS home-screen apps point at this site: "Bøtkjær Labs" (general) and
// "暴实验室", a shortcut whose start URL is /lab/hanzi (mandarin). Each has
// its own storage and its own push subscription, so a subscription is tagged
// with the app it was made in. The app is told apart by the first page the
// session opened on, recorded by recordLaunchPath() in the root providers.

export type PushApp = "general" | "mandarin";
const LAUNCH_PATH_KEY = "launchPath";

export function recordLaunchPath() {
  try {
    if (!sessionStorage.getItem(LAUNCH_PATH_KEY)) sessionStorage.setItem(LAUNCH_PATH_KEY, location.pathname);
  } catch {
    // Storage blocked: currentApp() falls back to the current path.
  }
}

export function isStandalone() {
  return (
    typeof window !== "undefined" &&
    ((navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

export function currentApp(): PushApp {
  let path = location.pathname;
  try {
    path = sessionStorage.getItem(LAUNCH_PATH_KEY) ?? path;
  } catch {}
  return path.startsWith("/lab/hanzi") ? "mandarin" : "general";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

async function saveSubscription(sub: PushSubscription) {
  const res = await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sub.toJSON(), app: currentApp() }),
  });
  if (!res.ok) throw new Error("Failed to save subscription");
}

// Asks for permission (must run from a tap) and subscribes this app.
// Resolves true once subscribed. Throws on failure.
export async function enablePush(): Promise<boolean> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));
  await saveSubscription(sub);
  return true;
}

// Re-saves this app's existing subscription with its app tag, without
// prompting. Keeps subscriptions made before tagging existed correct.
export async function syncPushSubscription() {
  if (!pushSupported() || !isStandalone() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await saveSubscription(sub);
}
