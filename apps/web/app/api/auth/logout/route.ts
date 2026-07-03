import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL } from "@/lib/auth";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("nexus_refresh_token")?.value;

  if (refreshToken) {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
    } catch {
      // Local cookies still need to be cleared if the API is unavailable.
    }
  }

  cookieStore.delete("nexus_access_token");
  cookieStore.delete("nexus_refresh_token");
  return NextResponse.redirect(new URL("/", request.url), 303);
}
