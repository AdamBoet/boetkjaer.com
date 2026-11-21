import webpush from "web-push";
import { supabaseAdmin } from "./supabase-server";

// Node-side mirror of send_notification() in mandarin-pipeline/daily_refresh.py —
// same push_subscriptions table and VAPID keypair, just invoked from a
// Vercel route instead of the local Python script (needed for the pipeline
// watchdog, which has to run independently of the process it's watching).
export type PushApp = "general" | "mandarin";

// Each iOS home-screen app has its own subscription, tagged with `app`
// (see /api/push-subscribe). Pass `app` to reach only that app's devices.
// Returns how many subscriptions the push was delivered to.
export async function sendPushToAll(
  title: string,
  body: string,
  { url, app }: { url?: string; app?: PushApp } = {}
): Promise<number> {
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPrivate || !vapidSubject || !vapidPublic) {
    console.warn("sendPushToAll: VAPID keys not set, skipping");
    return 0;
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let query = supabaseAdmin.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (app) query = query.eq("app", app);
  const { data: subs, error } = await query;
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, url })
      );
      sent++;
    } catch (e) {
      const statusCode = e instanceof webpush.WebPushError ? e.statusCode : null;
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      } else {
        console.error("sendPushToAll: notification failed", e);
      }
    }
  }
  return sent;
}
