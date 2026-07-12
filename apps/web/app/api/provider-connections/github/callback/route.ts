import { apiFetch } from "@/lib/auth";

interface GithubStatePayload {
  organizationId?: string;
}

function dashboardRedirect(request: Request, status: string) {
  const destination = new URL("/dashboard", request.url);
  destination.searchParams.set("github", status);
  return Response.redirect(destination, 303);
}

function readOrganizationId(state: string) {
  const encodedPayload = state.split(".")[0];
  if (!encodedPayload) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as GithubStatePayload;
    return payload.organizationId ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const setupAction = url.searchParams.get("setup_action");

  if (setupAction === "request" || setupAction === "cancel") {
    return dashboardRedirect(request, "cancelled");
  }
  if (!installationId || !state) {
    return dashboardRedirect(request, "invalid-callback");
  }

  const organizationId = readOrganizationId(state);
  if (!organizationId) {
    return dashboardRedirect(request, "invalid-callback");
  }

  try {
    const response = await apiFetch(
      `/organizations/${encodeURIComponent(organizationId)}/provider-connections/github/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId, state }),
      },
    );
    if (response.status === 401) {
      return dashboardRedirect(request, "session-expired");
    }
    if (!response.ok) {
      return dashboardRedirect(request, "connection-failed");
    }
    return dashboardRedirect(request, "connected");
  } catch {
    return dashboardRedirect(request, "connection-failed");
  }
}
