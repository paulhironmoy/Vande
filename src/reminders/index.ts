/**
 * Optional local daily reminder. Off by default. Android only (Capacitor Local Notifications);
 * the web has no way to schedule a notification without a server, and we do not run one for this.
 * Copy never guilt-trips: it tells the player something is ready, nothing else.
 */
const REMINDER_ID = 4120;

export const REMINDER_COPY = {
  title: "Today's crisis is ready",
  body: 'Three minutes, whenever you have time.',
  explainNative: 'A quiet daily note from this app. No account, no server.',
  explainWeb: 'Reminders work in the Android app. On the web, add VANDE to your home screen.',
  ask: 'Want a daily note when a new crisis is ready?',
} as const;

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Reminders can only be scheduled where a local notification plugin exists (the Android app). */
export function canUseReminders(): boolean {
  return isNativeShell();
}

export type ReminderResult = 'scheduled' | 'denied' | 'unsupported' | 'failed';

export async function scheduleDailyReminder(hour: number): Promise<ReminderResult> {
  if (!canUseReminders()) return 'unsupported';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return 'denied';
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => undefined);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REMINDER_ID,
          title: REMINDER_COPY.title,
          body: REMINDER_COPY.body,
          schedule: { on: { hour: Math.max(0, Math.min(23, Math.round(hour))), minute: 0 }, repeats: true, allowWhileIdle: false },
          sound: undefined,
        },
      ],
    });
    return 'scheduled';
  } catch {
    return 'failed';
  }
}

export async function cancelDailyReminder(): Promise<void> {
  if (!canUseReminders()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
  } catch {
    /* nothing to cancel */
  }
}

export const REMINDER_HOURS: { value: number; label: string }[] = [
  { value: 8, label: 'Morning' },
  { value: 12, label: 'Midday' },
  { value: 19, label: 'Evening' },
  { value: 21, label: 'Night' },
];
