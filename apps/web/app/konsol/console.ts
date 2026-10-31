export const TOKEN_KEY = "console_jwt";

export function socketUrl(path: string, token: string) {
  const base = process.env.NEXT_PUBLIC_WS_URL;
  if (!base) throw new Error("NEXT_PUBLIC_WS_URL belum diatur.");
  return `${base.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}

// Console credentials must not be replaced by the user's Supabase session in lib/api.
export async function consoleRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}${path}`, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    throw new Error(response.status === 401 ? "Sandi atau sesi tidak valid. Silakan masuk kembali." : "Permintaan gagal. Silakan coba lagi.");
  }
  return response.json() as Promise<T>;
}

export function closeMessage(code: number) {
  return ({ 4401: "Sesi tidak valid. Silakan masuk kembali.", 4404: "Panggilan tidak ditemukan.", 4409: "Panggilan sudah dibuka di tab lain.", 4410: "Panggilan sudah selesai." } as Record<number, string>)[code] ?? "Sambungan terputus. Kembali ke antrean untuk menyambung lagi.";
}
