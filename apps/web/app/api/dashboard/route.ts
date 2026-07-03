import { apiFetch } from "@/lib/auth";

async function jsonOrError(response: Response) {
  if (response.status === 401) {
    return {
      error: Response.json({ message: "Session expired" }, { status: 401 }),
    };
  }
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    return {
      error: Response.json(data, { status: response.status }),
    };
  }
  return { data };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedOrganizationId = url.searchParams.get("organizationId");
    const requestedWorkspaceId = url.searchParams.get("workspaceId");

    const profileResult = await jsonOrError(await apiFetch("/auth/profile"));
    if (profileResult.error) return profileResult.error;

    const organizationsResult = await jsonOrError(
      await apiFetch("/organizations"),
    );
    if (organizationsResult.error) return organizationsResult.error;
    const organizations = organizationsResult.data as {
      organizations: Array<{ id: string }>;
    };
    const organizationId = organizations.organizations.some(
      (organization) => organization.id === requestedOrganizationId,
    )
      ? requestedOrganizationId
      : organizations.organizations[0]?.id;

    if (!organizationId) {
      return Response.json({
        profile: profileResult.data,
        organizations: [],
        workspaces: [],
        repositories: [],
        connections: [],
      });
    }

    const workspacesResult = await jsonOrError(
      await apiFetch(`/organizations/${organizationId}/workspaces`),
    );
    if (workspacesResult.error) return workspacesResult.error;
    const workspaces = workspacesResult.data as {
      workspaces: Array<{ id: string }>;
    };
    const workspaceId = workspaces.workspaces.some(
      (workspace) => workspace.id === requestedWorkspaceId,
    )
      ? requestedWorkspaceId
      : workspaces.workspaces[0]?.id;

    const connectionsResult = await jsonOrError(
      await apiFetch(`/organizations/${organizationId}/provider-connections`),
    );
    if (connectionsResult.error) return connectionsResult.error;

    let repositories: unknown[] = [];
    if (workspaceId) {
      const repositoriesResult = await jsonOrError(
        await apiFetch(`/workspaces/${workspaceId}/repositories`),
      );
      if (repositoriesResult.error) return repositoriesResult.error;
      repositories = (repositoriesResult.data as { repositories: unknown[] })
        .repositories;
    }

    return Response.json({
      profile: profileResult.data,
      organizations: organizations.organizations,
      selectedOrganizationId: organizationId,
      workspaces: workspaces.workspaces,
      selectedWorkspaceId: workspaceId ?? null,
      repositories,
      connections: (connectionsResult.data as { connections: unknown[] })
        .connections,
    });
  } catch {
    return Response.json(
      { message: "Dashboard service unavailable" },
      { status: 503 },
    );
  }
}
