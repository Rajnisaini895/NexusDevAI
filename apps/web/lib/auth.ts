import { cookies } from "next/headers";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:3001/api";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
  };
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function setSessionCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  accessToken: string,
  refreshToken: string,
) {
  cookieStore.set("nexus_access_token", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60,
  });
  cookieStore.set("nexus_refresh_token", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function authenticate(email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const result = (await response.json()) as LoginResponse & {
    message?: string;
  };

  if (!response.ok) {
    return Response.json(
      { message: result.message ?? "Authentication failed" },
      { status: response.status },
    );
  }

  const cookieStore = await cookies();
  setSessionCookies(cookieStore, result.accessToken, result.refreshToken);

  return Response.json({ user: result.user });
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("nexus_access_token")?.value;
  const refreshToken = cookieStore.get("nexus_refresh_token")?.value;

  if (!accessToken && !refreshToken) {
    return new Response(null, { status: 401 });
  }

  const send = (token: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

  let response = accessToken
    ? await send(accessToken)
    : new Response(null, { status: 401 });

  if (response.status !== 401 || !refreshToken) return response;

  const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });

  if (!refreshResponse.ok) {
    cookieStore.delete("nexus_access_token");
    cookieStore.delete("nexus_refresh_token");
    return new Response(null, { status: 401 });
  }

  const refreshed = (await refreshResponse.json()) as RefreshResponse;
  accessToken = refreshed.accessToken;
  setSessionCookies(cookieStore, refreshed.accessToken, refreshed.refreshToken);
  response = await send(accessToken);
  return response;
}
