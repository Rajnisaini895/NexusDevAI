import { apiFetch } from "@/lib/auth";

function repositoryProcessPath(workspaceId: string, repositoryId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/process`;
}

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
      `${repositoryProcessPath(workspaceId, repositoryId)}/latest`,
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Repository processing status unavailable" },
      { status: 503 },
    );
  }
}

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
      repositoryProcessPath(body.workspaceId, repositoryId),
      { method: "POST" },
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Repository processing service unavailable" },
      { status: 503 },
    );
  }
}
