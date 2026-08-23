"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StatusPill from "@/components/StatusPill";
import AnalyticsPanel from "@/components/dashboard/AnalyticsPanel";
import FilterBar from "@/components/dashboard/FilterBar";
import NotificationPreferences, {
  NotificationsPanel
} from "@/components/dashboard/NotificationsPanel";
import DetectionSchedulesPanel from "@/components/dashboard/DetectionSchedulesPanel";
import ScheduleSection from "@/components/dashboard/ScheduleSection";
import StatsOverview from "@/components/dashboard/StatsOverview";
import {
  buildClientAlertMessage,
  getNewAlertChanges,
  loadNotificationPrefs,
  playAlertSound,
  requestBrowserPermission,
  saveNotificationPrefs,
  showBrowserNotification
} from "@/lib/clientAlerts";
import {
  matchesPriorityCategorySchedule,
  matchesPrioritySchedule,
  matchesSiteFilter,
  canonicalizeSchedule
} from "@/lib/monitorPriority";
import { BUSANZA_AUTOMATED_CENTER, normalizeCenterName } from "@/lib/examCenters";
import { scheduleMatchesCategory } from "@/lib/scheduleTime";

const tabs = [
  ["overview", "Overview"],
  ["schedules", "Schedules"],
  ["analytics", "Analytics"],
  ["notifications", "Notifications"]
];

export default function Dashboard({
  initialStatus,
  initialSchedules,
  initialChanges,
  initialAnalytics,
  initialNotifications,
  initialNotificationSettings,
  initialDetectionRules,
  initialMonitorSettings,
  initialDetectionCategories
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [status, setStatus] = useState(initialStatus);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [changes, setChanges] = useState(initialChanges);
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [notificationSettings, setNotificationSettings] = useState(initialNotificationSettings);
  const [detectionRules, setDetectionRules] = useState(initialDetectionRules || []);
  const [monitorSettings, setMonitorSettings] = useState(
    initialMonitorSettings || initialNotificationSettings?.monitor || { autoNotifyAll: true }
  );
  const [detectionCategories, setDetectionCategories] = useState(
    initialDetectionCategories || status?.monitor?.categories || []
  );
  const [detectionSaving, setDetectionSaving] = useState(false);
  const [scheduleFilter, setScheduleFilter] = useState("active");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [examTypeFilter, setExamTypeFilter] = useState("all");
  const [notificationPrefs, setNotificationPrefs] = useState(loadNotificationPrefs);
  const [isFetching, setIsFetching] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const mountedRef = useRef(false);
  const refreshInFlightRef = useRef(null);
  const previousChangesRef = useRef(initialChanges);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const skipTabRefreshRef = useRef(true);

  const remainingSlots = status?.remainingSlots ?? 0;
  const availableScheduleCount = status?.availableScheduleCount ?? schedules.length;

  const normalizedSchedules = useMemo(
    () => schedules.map((schedule) => canonicalizeSchedule(schedule)),
    [schedules]
  );

  const categoryOptions = useMemo(
    () => buildOptions(status?.monitor?.categories, normalizedSchedules, changes, "category"),
    [changes, normalizedSchedules, status]
  );
  const siteOptions = useMemo(
    () => buildCenterOptions(normalizedSchedules, changes),
    [changes, normalizedSchedules]
  );
  const examTypeOptions = useMemo(
    () => [status?.monitor?.service || "PRACTICAL_EXAM"].filter(Boolean),
    [status]
  );

  const priority = status?.monitor?.priority;
  const priorityCenter = priority?.center || BUSANZA_AUTOMATED_CENTER;
  const priorityCategory = priority?.category || "A";
  const priorityLocation = priority?.location || "Kicukiro";

  const busanzaSchedules = useMemo(
    () => normalizedSchedules.filter((schedule) => matchesPrioritySchedule(schedule, priority)),
    [normalizedSchedules, priority]
  );

  const busanzaCategoryASchedules = useMemo(
    () => normalizedSchedules.filter((schedule) => matchesPriorityCategorySchedule(schedule, priority)),
    [normalizedSchedules, priority]
  );

  const scheduleRows = useMemo(() => {
    let rows;

    if (scheduleFilter === "active") {
      rows = normalizedSchedules.map((schedule) => ({
        ...schedule,
        rowType: "ACTIVE",
        rowKey: schedule.scheduleId
      }));
    } else if (scheduleFilter === "removed") {
      rows = changes
        .filter((change) => change.type === "REMOVED_SCHEDULE")
        .map((change) => ({
          scheduleId: change.scheduleId,
          ...canonicalizeSchedule(parseChangeObject(change.oldValue)),
          rowType: "REMOVED",
          lastSeen: change.createdAt,
          rowKey: `change-${change.id}`
        }));
    } else {
      const schedulesById = new Map(normalizedSchedules.map((schedule) => [schedule.scheduleId, schedule]));
      rows = changes
        .filter((change) => change.type !== "REMOVED_SCHEDULE")
        .map((change) => {
          const activeSchedule = schedulesById.get(change.scheduleId);
          const createdSchedule = change.type === "NEW_SCHEDULE" ? parseChangeObject(change.newValue) : null;
          return {
            scheduleId: change.scheduleId,
            ...canonicalizeSchedule(activeSchedule || createdSchedule || {}),
            rowType: change.type,
            lastSeen: activeSchedule?.lastSeen || change.createdAt,
            rowKey: `change-${change.id}`
          };
        });
    }

    return rows.filter((schedule) => {
      const matchesCategory =
        categoryFilter === "all" || scheduleMatchesCategory(schedule, categoryFilter);
      const matchesSite = matchesSiteFilter(schedule, siteFilter);
      const matchesExamType =
        examTypeFilter === "all" || (status?.monitor?.service || "PRACTICAL_EXAM") === examTypeFilter;
      return matchesCategory && matchesSite && matchesExamType;
    });
  }, [
    categoryFilter,
    changes,
    examTypeFilter,
    normalizedSchedules,
    scheduleFilter,
    siteFilter,
    status
  ]);

  const handleClientAlerts = useCallback(
    (nextChanges) => {
      const freshChanges = getNewAlertChanges(previousChangesRef.current, nextChanges);
      if (freshChanges.length === 0) {
        return;
      }

      for (const change of freshChanges) {
        const message = buildClientAlertMessage(change);
        if (notificationPrefs.browser) {
          showBrowserNotification("Schedule availability update", message);
        }
        if (notificationPrefs.sound) {
          playAlertSound();
        }
      }
    },
    [notificationPrefs.browser, notificationPrefs.sound]
  );

  const refreshCore = useCallback(async () => {
    const [statusResponse, changesResponse] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/changes?limit=100")
    ]);

    if (!statusResponse.ok || !changesResponse.ok) {
      return null;
    }

    const [nextStatus, nextChanges] = await Promise.all([statusResponse.json(), changesResponse.json()]);
    return { nextStatus, nextChanges: nextChanges.changes || [] };
  }, []);

  const refreshSchedules = useCallback(async () => {
    const response = await fetch("/api/schedules?availableOnly=true");
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload.schedules || [];
  }, []);

  const refreshExtras = useCallback(async () => {
    const tab = activeTabRef.current;
    const requests = [];

    if (tab === "overview" || tab === "analytics") {
      requests.push(fetch("/api/analytics"));
    } else {
      requests.push(Promise.resolve(null));
    }

    if (tab === "overview" || tab === "notifications") {
      requests.push(fetch("/api/notifications?limit=30"));
    } else {
      requests.push(Promise.resolve(null));
    }

    if (tab === "notifications") {
      requests.push(fetch("/api/detection-rules"));
    } else {
      requests.push(Promise.resolve(null));
    }

    const [analyticsResponse, notificationsResponse, detectionRulesResponse] = await Promise.all(requests);
    const extras = {};

    if (analyticsResponse?.ok) {
      extras.nextAnalytics = await analyticsResponse.json();
    }

    if (notificationsResponse?.ok) {
      extras.nextNotifications = await notificationsResponse.json();
    }

    if (detectionRulesResponse?.ok) {
      extras.nextDetectionRules = await detectionRulesResponse.json();
    }

    return extras;
  }, []);

  const refresh = useCallback(
    async ({ includeSchedules = false, includeExtras = false } = {}) => {
      const tab = activeTabRef.current;
      const shouldLoadSchedules =
        includeSchedules || tab === "schedules" || tab === "overview";
      const shouldLoadExtras =
        includeExtras || tab === "overview" || tab === "analytics" || tab === "notifications";
      if (refreshInFlightRef.current) {
        return refreshInFlightRef.current;
      }

      const run = async () => {
        setIsFetching(true);
        try {
          const core = await refreshCore();
          if (!core || !mountedRef.current) {
            return;
          }

          handleClientAlerts(core.nextChanges);
          previousChangesRef.current = core.nextChanges;
          setStatus(core.nextStatus);
          setChanges(core.nextChanges);

          const tasks = [];
          if (shouldLoadSchedules) {
            tasks.push(refreshSchedules());
          } else {
            tasks.push(Promise.resolve(null));
          }

          if (shouldLoadExtras) {
            tasks.push(refreshExtras());
          } else {
            tasks.push(Promise.resolve(null));
          }

          const [nextSchedules, extras] = await Promise.all(tasks);
          if (!mountedRef.current) {
            return;
          }

          if (nextSchedules) {
            setSchedules(nextSchedules);
          }
          if (extras?.nextAnalytics) {
            setAnalytics(extras.nextAnalytics);
          }
          if (extras?.nextNotifications) {
            setNotifications(extras.nextNotifications.notifications || []);
            setNotificationSettings(extras.nextNotifications.settings || notificationSettings);
            if (extras.nextNotifications.settings?.monitor) {
              setMonitorSettings(extras.nextNotifications.settings.monitor);
            }
          }
          if (extras?.nextDetectionRules?.ok) {
            setDetectionRules(extras.nextDetectionRules.rules || []);
            setMonitorSettings(extras.nextDetectionRules.settings || monitorSettings);
            setDetectionCategories(extras.nextDetectionRules.categories || detectionCategories);
          }
        } catch {
          // Ignore transient network errors while polling.
        } finally {
          if (mountedRef.current) {
            setIsFetching(false);
          }
        }
      };

      refreshInFlightRef.current = run().finally(() => {
        refreshInFlightRef.current = null;
      });

      return refreshInFlightRef.current;
    },
    [handleClientAlerts, notificationSettings, refreshCore, refreshExtras, refreshSchedules]
  );

  useEffect(() => {
    mountedRef.current = true;
    refresh({ includeSchedules: true, includeExtras: true });

    const coreInterval = setInterval(() => refresh(), 15000);
    const heavyInterval = setInterval(
      () => refresh({ includeSchedules: true, includeExtras: true }),
      45000
    );
    const handleFocus = () => refresh({ includeSchedules: true, includeExtras: true });

    window.addEventListener("focus", handleFocus);
    return () => {
      mountedRef.current = false;
      clearInterval(coreInterval);
      clearInterval(heavyInterval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (activeTab === "analytics" && !analytics?.ok) {
      refresh({ includeExtras: true });
    }
  }, [activeTab, analytics?.ok, refresh]);

  useEffect(() => {
    if (skipTabRefreshRef.current) {
      skipTabRefreshRef.current = false;
      return;
    }
    refresh({ includeSchedules: activeTab === "schedules", includeExtras: true });
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveNotificationPrefs(notificationPrefs);
  }, [notificationPrefs]);

  async function handleEnableBrowser() {
    const permission = await requestBrowserPermission();
    setNotificationPrefs((current) => ({ ...current, browser: permission === "granted" }));
  }

  async function handleScanNow() {
    setIsScanning(true);
    const previousScanAt = status?.lastScanAt;

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Scan failed to start");
      }

      if (payload.status === "COMPLETED") {
        await refresh({ includeSchedules: true, includeExtras: true });
        return;
      }

      if (payload.status === "FAILED") {
        throw new Error(payload.error || "Scan failed");
      }

      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const stateResponse = await fetch("/api/scan");
        const state = await stateResponse.json().catch(() => ({}));

        if (!stateResponse.ok) {
          continue;
        }

        if (state.running) {
          continue;
        }

        if (state.lastError) {
          throw new Error(state.lastError);
        }

        if (state.lastScanAt && state.lastScanAt !== previousScanAt) {
          break;
        }

        if (payload.status === "ALREADY_RUNNING" && state.lastScanAt && state.lastScanAt !== previousScanAt) {
          break;
        }
      }

      await refresh({ includeSchedules: true, includeExtras: true });
    } catch (error) {
      console.error(error);
      window.alert(error.message || "Scan failed");
    } finally {
      setIsScanning(false);
    }
  }

  async function refreshDetectionRules() {
    const response = await fetch("/api/detection-rules");
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (payload.ok) {
      setDetectionRules(payload.rules || []);
      setMonitorSettings(payload.settings || monitorSettings);
      setDetectionCategories(payload.categories || detectionCategories);
    }
  }

  async function handleSaveMonitorSettings(nextSettings) {
    setDetectionSaving(true);
    try {
      const response = await fetch("/api/detection-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateSettings",
          autoNotifyAll: nextSettings.autoNotifyAll,
          alertEmail: nextSettings.alertEmail,
          alertPhone: nextSettings.alertPhone,
          alertWebhookUrl: nextSettings.alertWebhookUrl
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Failed to save settings");
      }
      setMonitorSettings(payload.settings);
      setNotificationSettings((current) => ({
        ...current,
        monitor: payload.settings,
        targets: payload.settings.targets,
        channels: payload.channels || current.channels,
        defaults: current.defaults
      }));
    } catch (error) {
      throw error;
    } finally {
      setDetectionSaving(false);
    }
  }

  async function handleCreateDetectionRule(rule) {
    setDetectionSaving(true);
    try {
      const response = await fetch("/api/detection-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Failed to create detection window");
      }
      await refreshDetectionRules();
    } catch (error) {
      throw error;
    } finally {
      setDetectionSaving(false);
    }
  }

  async function handleUpdateDetectionRule(id, rule) {
    setDetectionSaving(true);
    try {
      const response = await fetch("/api/detection-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...rule })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Failed to update detection window");
      }
      await refreshDetectionRules();
    } catch (error) {
      throw error;
    } finally {
      setDetectionSaving(false);
    }
  }

  async function handleDeleteDetectionRule(id) {
    setDetectionSaving(true);
    try {
      const response = await fetch(`/api/detection-rules?id=${id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Failed to delete detection window");
      }
      await refreshDetectionRules();
    } catch (error) {
      window.alert(error.message || "Failed to delete detection window");
    } finally {
      setDetectionSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef3f7] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Irembo monitor</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">Schedule Availability Command Center</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Track open driving-test slots, send multi-channel alerts, and review detection analytics in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={status?.ok ? "good" : "warn"}>{status?.status || "Unknown"}</StatusPill>
              <StatusPill>{isFetching ? "Refreshing" : "Live"}</StatusPill>
              <Link
                href="/admin/applicants"
                className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800"
              >
                DDL Admin
              </Link>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {tabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === value
                    ? "bg-teal-700 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {activeTab === "overview" ? (
          <div className="space-y-6">
            <StatsOverview
              status={status}
              scheduleCount={availableScheduleCount}
              remainingSlots={remainingSlots}
              isFetching={isFetching}
              isScanning={isScanning}
              onScanNow={handleScanNow}
            />
            <section className="rounded-xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Priority watch</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">{priorityCenter}</p>
                  <p className="mt-1 text-sm text-slate-700">
                    {busanzaSchedules.length} open schedule(s) at {priorityCenter} ({priorityLocation}).{" "}
                    {busanzaCategoryASchedules.length} match Category {priorityCategory} priority.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("schedules");
                      setScheduleFilter("active");
                      setCategoryFilter("all");
                      setSiteFilter(priorityCenter);
                    }}
                    className="rounded-lg border border-teal-700 bg-white px-4 py-2 text-sm font-semibold text-teal-800"
                  >
                    Show {priorityCenter}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("schedules");
                      setScheduleFilter("active");
                      setCategoryFilter(priorityCategory);
                      setSiteFilter(priorityCenter);
                    }}
                    className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Show {priorityCenter} · Cat {priorityCategory}
                  </button>
                </div>
              </div>
            </section>
            <NotificationPreferences
              settings={notificationSettings}
              prefs={notificationPrefs}
              onChange={setNotificationPrefs}
              onEnableBrowser={handleEnableBrowser}
            />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
              <AnalyticsPanel analytics={analytics} />
              <NotificationsPanel notifications={notifications.slice(0, 8)} settings={notificationSettings} />
            </div>
          </div>
        ) : null}

        {activeTab === "schedules" ? (
          <div className="space-y-4">
            <FilterBar
              categoryFilter={categoryFilter}
              siteFilter={siteFilter}
              examTypeFilter={examTypeFilter}
              categoryOptions={categoryOptions}
              siteOptions={siteOptions}
              examTypeOptions={examTypeOptions}
              onCategoryChange={setCategoryFilter}
              onSiteChange={setSiteFilter}
              onExamTypeChange={setExamTypeFilter}
              onClear={() => {
                setCategoryFilter("all");
                setSiteFilter("all");
                setExamTypeFilter("all");
              }}
            />
            <ScheduleSection
              scheduleFilter={scheduleFilter}
              onScheduleFilterChange={setScheduleFilter}
              scheduleRows={scheduleRows}
              schedules={schedules}
              changes={changes}
            />
          </div>
        ) : null}

        {activeTab === "analytics" ? <AnalyticsPanel analytics={analytics} /> : null}

        {activeTab === "notifications" ? (
          <div className="space-y-6">
            <DetectionSchedulesPanel
              rules={detectionRules}
              settings={monitorSettings}
              categories={detectionCategories}
              saving={detectionSaving}
              onSaveSettings={handleSaveMonitorSettings}
              onCreateRule={handleCreateDetectionRule}
              onUpdateRule={handleUpdateDetectionRule}
              onDeleteRule={handleDeleteDetectionRule}
            />
            <NotificationPreferences
              settings={notificationSettings}
              prefs={notificationPrefs}
              onChange={setNotificationPrefs}
              onEnableBrowser={handleEnableBrowser}
            />
            <NotificationsPanel notifications={notifications} settings={notificationSettings} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function buildCenterOptions(schedules, changes) {
  const centers = new Map();

  function addCenter(center) {
    const normalized = normalizeCenterName(center);
    if (!normalized) {
      return;
    }
    centers.set(normalized.toLowerCase(), normalized);
  }

  for (const schedule of schedules) {
    addCenter(schedule.center);
  }
  for (const change of changes) {
    addCenter(parseChangeObject(change.oldValue).center);
    addCenter(parseChangeObject(change.newValue).center);
  }

  return ["all", ...[...centers.values()].sort((a, b) => a.localeCompare(b))];
}

function buildOptions(seedValues, schedules, changes, field) {
  const values = new Set(Array.isArray(seedValues) ? seedValues : []);
  for (const schedule of schedules) {
    if (schedule[field]) {
      values.add(schedule[field]);
    }
  }
  for (const change of changes) {
    const oldSchedule = parseChangeObject(change.oldValue);
    const newSchedule = parseChangeObject(change.newValue);
    if (oldSchedule[field]) {
      values.add(oldSchedule[field]);
    }
    if (newSchedule[field]) {
      values.add(newSchedule[field]);
    }
  }
  return ["all", ...[...values].sort()];
}

function parseChangeObject(value) {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
