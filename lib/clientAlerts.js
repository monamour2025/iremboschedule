const STORAGE_KEY = "irembo-monitor-notification-prefs";

const defaultPrefs = {
  browser: false,
  sound: true,
  email: true,
  webhook: true,
  phone: false
};

export function loadNotificationPrefs() {
  if (typeof window === "undefined") {
    return defaultPrefs;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultPrefs, ...JSON.parse(stored) } : { ...defaultPrefs };
  } catch {
    return { ...defaultPrefs };
  }
}

export function saveNotificationPrefs(prefs) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultPrefs, ...prefs }));
}

export async function requestBrowserPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission === "denied") {
    return "denied";
  }

  return Notification.requestPermission();
}

export function showBrowserNotification(title, body) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  new Notification(title, {
    body,
    icon: "/favicon.ico"
  });
  return true;
}

export function playAlertSound() {
  if (typeof window === "undefined") {
    return;
  }

  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.25);
}

export function buildClientAlertMessage(change) {
  try {
    const schedule = change.newValue ? JSON.parse(change.newValue) : null;
    if (!schedule) {
      return change.type;
    }

    return `${schedule.center || "Unknown"} · ${schedule.location || "Unknown"} · Category ${
      schedule.category || "?"
    } · ${schedule.remainingCapacity ?? "?"} slots`;
  } catch {
    return change.type;
  }
}

export function getNewAlertChanges(previousChanges, nextChanges) {
  const seen = new Set(previousChanges.map((change) => change.id));
  return nextChanges.filter(
    (change) =>
      !seen.has(change.id) &&
      ["NEW_SCHEDULE", "CAPACITY_INCREASE"].includes(change.type)
  );
}
