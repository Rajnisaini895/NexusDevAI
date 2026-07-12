import { apiFetch } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    workspaceId?: string;
    connectionId?: string;
    externalRepositoryId?: string;
  };
  if (!body.workspaceId || !body.connectionId || !body.externalRepositoryId) {
    return Response.json(
      { message: "Workspace, connection, and repository are required" },
      { status: 400 },
    );
  }

  try {
    const response = await apiFetch(
      `/workspaces/${encodeURIComponent(body.workspaceId)}/repositories/import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: body.connectionId,
          externalRepositoryId: body.externalRepositoryId,
        }),
      },
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Repository import service unavailable" },
      { status: 503 },
    );
  }
}
