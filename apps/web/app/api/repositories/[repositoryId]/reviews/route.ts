import { apiFetch } from "@/lib/auth";

function repositoryReviewsPath(workspaceId: string, repositoryId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(repositoryId)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const { repositoryId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");

  if (!workspaceId) {
    return Response.json(
      { message: "Workspace is required" },
      { status: 400 },
    );
  }

  try {
    const response = await apiFetch(
      `${repositoryReviewsPath(workspaceId, repositoryId)}/reviews`,
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Code review service unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const { repositoryId } = await params;
  const body = (await request.json()) as {
    workspaceId?: string;
    limit?: number;
  };

  if (!body.workspaceId) {
    return Response.json(
      { message: "Workspace is required" },
      { status: 400 },
    );
  }

  try {
    const response = await apiFetch(
      `${repositoryReviewsPath(body.workspaceId, repositoryId)}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: body.limit ?? 4 }),
      },
    );
    if (response.status === 401) {
      return Response.json({ message: "Session expired" }, { status: 401 });
    }
    const result = (await response.json()) as unknown;
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json(
      { message: "Code review service unavailable" },
      { status: 503 },
    );
  }
}
