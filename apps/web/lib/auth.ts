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
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };

  cookieStore.set("nexus_access_token", result.accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60,
  });
  cookieStore.set("nexus_refresh_token", result.refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60,
  });

  return Response.json({ user: result.user });
}
