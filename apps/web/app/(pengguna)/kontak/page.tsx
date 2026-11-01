"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { saveLocalContacts } from "@/lib/offline-store";
import { PageHead } from "@/components/PageHead";

interface Contact { id: string; name: string; phone: string; relation?: string }
interface Created { contact?: Contact; status_url?: string; share_text?: string }
const input = "m-field";

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
    <main className="text-[var(--color-text)]">
      <PageHead title="Kontak darurat" lead="Maksimal 3 orang. Mereka dapat tautan status saat Anda minta bantuan." back="/pengaturan" tone="mauve" />
      <div className="s-page">
      {list.map((c, n) => (
        <article key={c.id} className="s-panel m-surface" style={{ "--i": n + 1 } as React.CSSProperties}>
          <p className="text-lg font-bold">
            {c.name}
            {c.relation ? ` (${c.relation})` : ""}
          </p>
          <p className="text-[var(--color-text-muted)]">{c.phone}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {shares[c.id] && (
              <a href={wa(shares[c.id])} target="_blank" rel="noreferrer" className="m-btn m-btn--sm">
                Bagikan lewat WhatsApp
              </a>
            )}
            <button onClick={() => rotate(c.id)} className="m-btn m-btn--sm m-btn--line">
              Tautan baru
            </button>
            <button onClick={() => del(c.id)} className="m-btn m-btn--sm m-btn--danger">
              Hapus
            </button>
          </div>
        </article>
      ))}
      {list.length < 3 ? (
        <form onSubmit={add} className="s-panel m-surface space-y-4" style={{ "--i": list.length + 1 } as React.CSSProperties}>
          <h2 className="s-h2">Tambah kontak</h2>
          <label className="block">
            <span className="m-label">Nama</span>
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="m-label">Nomor ponsel</span>
            <input
              className={input}
              type="tel"
              inputMode="tel"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="m-label">Hubungan</span>
            <input className={input} value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} />
          </label>
          {err && (
            <p role="alert" className="font-semibold text-[var(--color-sos)]">
              {err}
            </p>
          )}
          <button className="m-btn w-full">Tambah kontak</button>
        </form>
      ) : (
        <p className="s-panel m-surface text-[var(--color-text-muted)]">Maksimal 3 kontak.</p>
      )}
      </div>
    </main>
  );
}
