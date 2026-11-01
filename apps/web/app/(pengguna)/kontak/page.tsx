"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { saveLocalContacts } from "@/lib/offline-store";
import { PageHead } from "@/components/PageHead";
import { CopyIcon, PhoneIcon, PlusIcon, ShareIcon, TrashIcon } from "@/components/icons";

interface Contact { id: string; name: string; phone: string; relation?: string }
interface Created { contact?: Contact; status_url?: string; share_text?: string }
const MAX = 3;
const RELATIONS = ["Orang tua", "Pasangan", "Saudara", "Teman", "Tetangga"];

function norm(raw: string) {
  const s = raw.replace(/[\s-]/g, "");
  return s.startsWith("08") ? "+62" + s.slice(1) : s.startsWith("62") ? "+" + s : s;
}
const wa = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export default function Kontak() {
  const [list, setList] = useState<Contact[] | null>(null);
  // Raw token is only returned on create/rotate, so share text lives in memory for this visit only.
  const [shares, setShares] = useState<Record<string, string>>({});
  const [f, setF] = useState({ name: "", phone: "", relation: "" });
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<string | null>(null); // contact id waiting for delete confirmation
  const [canShare, setCanShare] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const d = await api<Contact[] | { contacts: Contact[] }>("/v1/me/contacts");
    const c = Array.isArray(d) ? d : d.contacts;
    setList(c);
    setAdding(c.length === 0);
    await saveLocalContacts(c).catch(() => {});
  }, []);
  useEffect(() => {
    setCanShare("share" in navigator);
    load().catch(() => {
      setList([]);
      setErr("Kontak belum bisa dimuat. Periksa internet lalu buka lagi halaman ini.");
    });
  }, [load]);

  const phone = norm(f.phone);
  const phoneOk = /^\+62[0-9]{8,13}$/.test(phone);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Isi nama kontak.");
    if (!phoneOk) return setErr("Nomor belum benar. Contoh: 0812 3456 7890");
    setErr("");
    try {
      const d = await api<Created>("/v1/me/contacts", {
        method: "POST",
        body: JSON.stringify({ name: f.name.trim(), phone, relation: f.relation || null }),
      });
      if (d.contact && d.share_text) setShares((s) => ({ ...s, [d.contact!.id]: d.share_text! }));
      setF({ name: "", phone: "", relation: "" });
      await load();
      setAdding(false);
      setNote("Kontak ditambahkan. Kirim tautan status ke mereka.");
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "Gagal menambah kontak.");
    }
  }
  async function del(id: string) {
    setAsk(null);
    try {
      await api(`/v1/me/contacts/${id}`, { method: "DELETE" });
      await load();
      setNote("Kontak dihapus.");
    } catch {
      setErr("Gagal menghapus kontak.");
    }
  }
  async function rotate(id: string) {
    try {
      const d = await api<Created>(`/v1/me/contacts/${id}/rotate-token`, { method: "POST" });
      if (d.share_text) setShares((s) => ({ ...s, [id]: d.share_text! }));
      setNote("Tautan baru dibuat. Tautan lama tidak berlaku lagi.");
    } catch {
      setErr("Gagal membuat tautan baru.");
    }
  }
  async function share(text: string) {
    try {
      if (navigator.share) return await navigator.share({ text });
      await navigator.clipboard.writeText(text);
      setNote("Tautan disalin.");
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <main className="text-[var(--color-text)]">
      <PageHead title="Kontak darurat" lead={`Maksimal ${MAX} orang. Mereka dapat tautan status dan SMS saat panggilan gagal.`} back="/pengaturan" tone="mauve" />
      <div className="s-page">
        {note && <p role="status" className="s-panel tone-sage font-semibold">{note}</p>}

        {list?.map((c, n) => (
          <article key={c.id} className="s-panel m-surface space-y-4" style={{ "--i": n + 1 } as React.CSSProperties}>
            <div className="flex items-start gap-3">
              <span aria-hidden className="s-display flex size-12 shrink-0 items-center justify-center bg-[color:var(--color-primary)] text-[22px] font-black text-[color:var(--color-on-primary)]">
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[20px] leading-7 font-bold">{c.name}</p>
                <p className="text-[16px] text-text-muted">
                  {c.relation ? `${c.relation} · ` : ""}
                  <span className="font-mono">{c.phone}</span>
                </p>
              </div>
              <a href={`tel:${c.phone}`} aria-label={`Telepon ${c.name}`} className="m-icon-btn !bg-transparent shadow-[inset_0_0_0_2px_currentColor]">
                <PhoneIcon size={22} />
              </a>
            </div>
            {shares[c.id] ? (
              <div className="grid grid-cols-2 gap-2">
                <a href={wa(shares[c.id])} target="_blank" rel="noreferrer" className="m-btn m-btn--sm">WhatsApp</a>
                <button type="button" onClick={() => share(shares[c.id])} className="m-btn m-btn--sm m-btn--line">
                  {canShare ? <ShareIcon size={20} /> : <CopyIcon size={20} />}
                  {canShare ? "Bagikan" : "Salin"}
                </button>
              </div>
            ) : null}
            {ask === c.id ? (
              <div role="alertdialog" aria-label={`Hapus ${c.name}?`} className="space-y-2 bg-[color:var(--color-bg)] p-3">
                <p className="font-bold">Hapus {c.name}? Mereka tidak dikabari lagi.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" autoFocus onClick={() => setAsk(null)} className="m-btn m-btn--sm m-btn--line">Batal</button>
                  <button type="button" onClick={() => del(c.id)} className="m-btn m-btn--sm m-btn--sos">Ya, hapus</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-x-5">
                <button type="button" onClick={() => rotate(c.id)} className="m-link text-[16px]">
                  {shares[c.id] ? "Buat tautan baru" : "Buat tautan status"}
                </button>
                <button type="button" onClick={() => setAsk(c.id)} className="m-link gap-1 text-[16px] text-[color:var(--color-sos)]">
                  <TrashIcon size={18} />
                  Hapus
                </button>
              </div>
            )}
          </article>
        ))}

        {list && list.length === 0 && !err && (
          <p className="s-panel m-surface text-[18px] leading-7">
            Belum ada kontak. Tambahkan orang yang bisa segera datang atau menelepon 112 untuk Anda.
          </p>
        )}

        {list && list.length < MAX && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="m-btn w-full">
            <PlusIcon size={22} />
            Tambah kontak ({list.length}/{MAX})
          </button>
        )}

        {list && list.length < MAX && adding && (
          <form onSubmit={add} noValidate className="s-panel m-surface space-y-4">
            <h2 className="s-h2">Tambah kontak</h2>
            <label className="block">
              <span className="m-label">Nama</span>
              <input className="m-field" value={f.name} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="m-label">Nomor ponsel</span>
              <input
                className="m-field font-mono"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0812 3456 7890"
                aria-describedby="phone-help"
                aria-invalid={f.phone !== "" && !phoneOk}
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
              />
              <span id="phone-help" className={`mt-1 block text-[15px] ${f.phone && !phoneOk ? "font-bold text-[color:var(--color-sos)]" : "text-text-muted"}`}>
                {f.phone && phoneOk ? `Disimpan sebagai ${phone}` : "Nomor Indonesia, diawali 08 atau +62."}
              </span>
            </label>
            <fieldset>
              <legend className="m-label">Hubungan (boleh dilewati)</legend>
              <div className="flex flex-wrap gap-2">
                {RELATIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={f.relation === r}
                    onClick={() => setF({ ...f, relation: f.relation === r ? "" : r })}
                    className={`m-btn m-btn--sm !min-h-11 !px-3.5 ${f.relation === r ? "" : "m-btn--line"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </fieldset>
            {err && (
              <p role="alert" className="font-semibold text-[color:var(--color-sos)]">
                {err}
              </p>
            )}
            <button className="m-btn w-full">Simpan kontak</button>
            {list.length > 0 && (
              <button type="button" onClick={() => setAdding(false)} className="min-h-12 w-full font-bold">Batal</button>
            )}
          </form>
        )}

        {err && !adding && (
          <p role="alert" className="s-panel m-surface font-semibold text-[color:var(--color-sos)]">{err}</p>
        )}
        {list && list.length >= MAX && <p className="px-2 text-text-muted">Sudah {MAX} kontak. Hapus satu untuk menambah yang lain.</p>}
      </div>
    </main>
  );
}
