"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { loadProfile } from "@/lib/geo";

// Routes inside (pengguna) that must stay reachable without a session.
const PUBLIC = ["/mulai", "/masuk", "/offline"];
// TODO(integrator): T13's /mulai must set this localStorage flag when finished or skipped.
const SEEN_KEY = "j112.seen_intro";

export default function PenggunaLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [silent, setSilent] = useState(false);
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isPublic) {
        setReady(true);
        return;
      }
      let seen = true;
      try {
        seen = localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        /* storage blocked: skip the intro */
      }
      if (!seen) return void router.replace("/mulai");
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (!data.session) return void router.replace("/masuk");
      setReady(true);
      const p = await loadProfile();
      if (alive && p) {
        document.documentElement.classList.toggle("silent", !!p.silent_mode);
        setSilent(!!p.silent_mode);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isPublic, router, path]);

  if (!ready) return null;
  return (
    <>
      {silent && <div className="silent-dim" aria-hidden />}
      {children}
    </>
  );
}
