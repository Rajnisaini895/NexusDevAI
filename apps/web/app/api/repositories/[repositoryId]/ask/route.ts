import { apiFetch } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const { repositoryId } = await params;
  const body = (await request.json()) as {
    workspaceId?: string;
    query?: string;
  };

  if (!body.workspaceId || !body.query?.trim()) {
    return Response.json(
      { message: "Workspace and question are required" },
      { status: 400 },
    );
  }

  try {
    const response = await apiFetch(
      `/workspaces/${encodeURIComponent(body.workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/ask`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: body.query.trim(), limit: 6 }),
      },
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Repository question service unavailable" },
      { status: 503 },
    );
  }
}
