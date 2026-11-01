export { cn } from "cn"

/** One random id per device, shared by sign-in (POST /v1/me/devices) and every call (CreateCall.device_key). */
export function deviceKey(): string {
  try {
    let k = localStorage.getItem("j112.device_key") ?? localStorage.getItem("j112_device_key"); // old sign-in key
    if (!k) k = crypto.randomUUID();
    localStorage.setItem("j112.device_key", k);
    return k;
  } catch {
    return crypto.randomUUID();
  }
}
