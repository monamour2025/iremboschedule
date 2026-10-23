import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";

export const dynamic = "force-dynamic";

// Booking takes minutes, longer than a Vercel request, so the button starts the GitHub job.
const WORKFLOW_FILE = "schedule-scan.yml";

function githubConfig() {
  const token = String(process.env.GITHUB_ACTIONS_TOKEN || "").trim();
  const repo = String(process.env.GITHUB_REPOSITORY || "monamour2025/iremboschedule").trim();
  if (!token) {
    const error = new Error(
      "GITHUB_ACTIONS_TOKEN is not set on the server. Add a GitHub token with Actions read/write access in Vercel → Settings → Environment Variables, then redeploy."
    );
    error.statusCode = 500;
    throw error;
  }
  return { token, repo };
}

async function github(path, { token, repo }, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    cache: "no-store"
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`GitHub answered ${response.status}: ${text.slice(0, 200) || response.statusText}`);
    error.statusCode = 502;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function latestRun(config) {
  const payload = await github(`/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`, config);
  const run = payload?.workflow_runs?.[0];
  if (!run) {
    return null;
  }
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    startedAt: run.run_started_at || run.created_at,
    updatedAt: run.updated_at,
    url: run.html_url
  };
}

function isActive(run) {
  return Boolean(run) && ["queued", "in_progress", "waiting", "pending", "requested"].includes(run.status);
}

export async function GET(request) {
  try {
    assertAdminAccess(request);
    const run = await latestRun(githubConfig());
    return Response.json({ ok: true, running: isActive(run), run });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const config = githubConfig();
    const current = await latestRun(config);
    if (isActive(current)) {
      return Response.json({ ok: true, alreadyRunning: true, run: current });
    }
    await github(`/actions/workflows/${WORKFLOW_FILE}/dispatches`, config, {
      method: "POST",
      body: JSON.stringify({ ref: "main", inputs: { mode: "create" } })
    });
    logger.info("Create Application run requested from Queue page");
    return Response.json({ ok: true, started: true });
  } catch (error) {
    logger.error("Create Application dispatch failed", { message: error.message });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
