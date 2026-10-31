"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { saveLocalContacts } from "@/lib/offline-store";

interface Contact { id: string; name: string; phone: string; relation?: string }
interface Created { contact?: Contact; status_url?: string; share_text?: string }
const input =
  "mt-1 min-h-12 w-full rounded-xl border-2 border-[var(--color-text-muted)] bg-[var(--color-surface)] px-4 text-lg";

function norm(raw: string) {
  const s = raw.replace(/[\s-]/g, "");
  return s.startsWith("08") ? "+62" + s.slice(1) : s;
}
const wa = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export default function Kontak() {
  const [list, setList] = useState<Contact[]>([]);
  // Raw token is only returned on create/rotate, so share text lives in memory for this visit only.
  const [shares, setShares] = useState<Record<string, string>>({});
  const [f, setF] = useState({ name: "", phone: "", relation: "" });
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const d = await api<Contact[] | { contacts: Contact[] }>("/v1/me/contacts");
    const c = Array.isArray(d) ? d : d.contacts;
    setList(c);
    await saveLocalContacts(c).catch(() => {});
  }, []);
  useEffect(() => {
    load().catch(() => setErr("Gagal memuat kontak."));
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const phone = norm(f.phone);
    if (!f.name.trim() || !/^\+62[0-9]{8,13}$/.test(phone)) return setErr("Isi nama dan nomor yang valid.");
    setErr("");
    try {
      const d = await api<Created>("/v1/me/contacts", {
        method: "POST",
        body: JSON.stringify({ name: f.name, phone, relation: f.relation || null }),
      });
      if (d.contact && d.share_text) setShares((s) => ({ ...s, [d.contact!.id]: d.share_text! }));
      setF({ name: "", phone: "", relation: "" });
      await load();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "Gagal menambah kontak.");
    }
  }
  async function del(id: string) {
    if (!confirm("Hapus kontak ini?")) return;
    await api(`/v1/me/contacts/${id}`, { method: "DELETE" });
    await load();
  }
  async function rotate(id: string) {
    const d = await api<Created>(`/v1/me/contacts/${id}/rotate-token`, { method: "POST" });
    if (d.share_text) setShares((s) => ({ ...s, [id]: d.share_text! }));
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-6 pb-24 text-[var(--color-text)]">
      <h1 className="text-3xl font-bold">Kontak darurat</h1>
      {list.map((c) => (
        <article key={c.id} className="rounded-xl bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <p className="text-lg font-bold">
            {c.name}
            {c.relation ? ` (${c.relation})` : ""}
          </p>
          <p className="text-[var(--color-text-muted)]">{c.phone}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {shares[c.id] && (
              <a
                href={wa(shares[c.id])}
                target="_blank"
                rel="noreferrer"
                className="min-h-12 rounded-xl bg-[var(--color-primary)] px-4 py-3 font-bold text-white"
              >
                Bagikan lewat WhatsApp
              </a>
            )}
            <button
              onClick={() => rotate(c.id)}
              className="min-h-12 rounded-xl border-2 border-[var(--color-primary)] px-4 font-bold text-[var(--color-accent)]"
            >
              Tautan baru
            </button>
            <button
              onClick={() => del(c.id)}
              className="min-h-12 rounded-xl border-2 border-[var(--color-sos)] px-4 font-bold text-[var(--color-sos)]"
            >
              Hapus
            </button>
          </div>
        </article>
      ))}
      {list.length < 3 ? (
        <form onSubmit={add} className="space-y-3">
          <label className="block">
            <span className="font-bold">Nama</span>
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="font-bold">Nomor ponsel</span>
            <input
              className={input}
              type="tel"
              inputMode="tel"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="font-bold">Hubungan</span>
            <input className={input} value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} />
          </label>
          <p role="alert" className="text-[var(--color-sos)]">
            {err}
          </p>
          <button className="min-h-14 w-full rounded-xl bg-[var(--color-primary)] text-lg font-bold text-white">
            Tambah kontak
          </button>
        </form>
      ) : (
        <p className="text-[var(--color-text-muted)]">Maksimal 3 kontak.</p>
      )}
    </main>
  );
}
