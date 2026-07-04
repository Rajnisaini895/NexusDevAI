import { apiFetch } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const { repositoryId } = await params;
  const body = (await request.json()) as { workspaceId?: string };

  if (!body.workspaceId) {
    return Response.json({ message: "Workspace is required" }, { status: 400 });
  }

  try {
    const response = await apiFetch(
      `/workspaces/${encodeURIComponent(body.workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/embed`,
      { method: "POST" },
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Embedding service unavailable" },
      { status: 503 },
    );
  }
}
