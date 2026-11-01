"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { loadProfile } from "@/lib/geo";
import { setLargeText } from "@/lib/theme";

// Routes inside (pengguna) that must stay reachable without a session (latihan and kartu work from local data).
const PUBLIC = ["/mulai", "/masuk", "/offline", "/latihan", "/kartu"];
// Set by app/mulai when the intro is finished or skipped.
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
      // Show the screen at once (an emergency cannot wait on an auth round trip); leave if there is no session.
      setReady(true);
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (!data.session) return void router.replace("/masuk");
      const p = await loadProfile();
      if (alive && p && !p.local) {
        document.documentElement.classList.toggle("silent", !!p.silent_mode);
        setSilent(!!p.silent_mode);
        setLargeText(!!p.large_text);
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
