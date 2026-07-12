import { apiFetch } from "@/lib/auth";

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  if (!organizationId) {
    return Response.json(
      { message: "Organization is required" },
      { status: 400 },
    );
  }

  try {
    const response = await apiFetch(
      `/organizations/${encodeURIComponent(organizationId)}/provider-connections/github/install-url`,
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "GitHub connection service unavailable" },
      { status: 503 },
    );
  }
}
