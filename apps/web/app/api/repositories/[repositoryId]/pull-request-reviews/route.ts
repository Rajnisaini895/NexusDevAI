import { apiFetch } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const { repositoryId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return Response.json({ message: "Workspace is required" }, { status: 400 });
  }

  try {
    const response = await apiFetch(
      `/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/pull-request-reviews/latest`,
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Pull request review status unavailable" },
      { status: 503 },
    );
  }
}
