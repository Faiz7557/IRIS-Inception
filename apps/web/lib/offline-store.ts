// Raw IndexedDB copy of profile + contacts, used only by the offline SMS screen (TRD §9).
export interface LocalProfile { display_name: string; address?: string | null; landmark?: string | null }
export interface LocalContact { name: string; phone: string }

const DB = "j112";
const P = "profile_local";
const C = "contacts_local";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(P);
      r.result.createObjectStore(C);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveLocalProfile(p: LocalProfile): Promise<void> {
  await run(P, "readwrite", (s) => { s.put(p, "me"); });
}
export async function saveLocalContacts(c: LocalContact[]): Promise<void> {
  await run(C, "readwrite", (s) => { s.put(c.map(({ name, phone }) => ({ name, phone })), "all"); });
}
export async function loadLocal(): Promise<{ profile: LocalProfile | null; contacts: LocalContact[] }> {
  try {
    const profile = ((await run<LocalProfile>(P, "readonly", (s) => s.get("me"))) ?? null) as LocalProfile | null;
    const contacts = ((await run<LocalContact[]>(C, "readonly", (s) => s.get("all"))) ?? []) as LocalContact[];
    return { profile, contacts };
  } catch {
    return { profile: null, contacts: [] };
  }
}
export function clearLocal(): Promise<void> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
