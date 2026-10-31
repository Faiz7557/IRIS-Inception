import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** Extra fields of the error body, e.g. 409 `call_id`, 429 `retry_after_s`. */
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Server error shape: {"error":{"code","message"}} */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let code = "unknown";
    let message = res.statusText;
    let details: Record<string, unknown> = {};
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } & Record<string, unknown> };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
      details = j.error ?? {};
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, message, res.status, details);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
