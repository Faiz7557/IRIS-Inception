// UI copy deck, ../docs/02_Design_Brief.md §11. Keep keys and text in sync with the doc.
export const COPY = {
  "home.title": "Darurat apa?",
  "home.sos": "TAHAN 3 DETIK",
  "home.sos.release_early": "Tahan sampai 3",
  "home.location.ok": "Lokasi: GPS akurat {m} m",
  "home.location.none": "Lokasi GPS tidak ada. Alamat profil dipakai.",
  "call.dialing": "Memanggil 112…",
  "call.attempt": "Percobaan {n} dari 3",
  "call.connected": "Tersambung 112",
  "call.opener.title": "Operator sedang mendengar:",
  "call.operator_speaking": "Operator bicara…",
  "call.repeat": "Minta ulangi",
  "call.sending": "Dibacakan…",
  "call.sent": "Terkirim",
  "call.cancel": "Batalkan",
  "call.cancel.confirm": "Batalkan panggilan?",
  "call.degraded": "Mode sederhana",
  "help.title": "Bantuan dikirim",
  "help.stay_safe": "Tetap di tempat aman. Layar ini bisa ditunjukkan ke petugas.",
  "fallback.title": "Panggilan belum tersambung",
  "fallback.contacts_notified": "Kontak darurat sudah diberi tahu lokasi Anda.",
  "fallback.retry": "Coba lagi",
  "fallback.sms": "Kirim SMS",
  "offline.title": "Internet putus",
  "practice.banner": "LATIHAN, tidak menelepon 112",
  "consent.medical":
    "Saya setuju kondisi medis saya dibacakan ke operator 112 saat saya meminta bantuan.",
} as const;

export function t(key: keyof typeof COPY, vars?: Record<string, string | number>): string {
  let text: string = COPY[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
