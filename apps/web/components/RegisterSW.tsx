"use client";
import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      return;
    }
    // Dev chunk URLs are not content-hashed, so sw.js (cache-first on /_next/static/) would pin stale code.
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    caches?.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }, []);
  return null;
}
