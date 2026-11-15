/**
 * Scenes saved from the app: a whole-field snapshot (.rdui encoding) plus the view, kept in
 * IndexedDB (a field is megabytes, too big for localStorage). Listed in the Rules menu with
 * the scenes of their rule's family; loading one restores the field exactly as saved.
 */

const DB = 'rdui';
const STORE = 'saved-scenes';

export interface SavedScene {
  id: string;
  name: string;
  /** The rule id it was made with (builtin:8, user:…), for its family in the Rules menu. */
  base: string;
  created: number;
  /** The field (encodeSnapshot). */
  data: Blob;
  /** View and painting settings to restore. */
  view: Record<string, unknown>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SavedScenes {
  /** Loaded at startup (load()), newest last. */
  scenes: SavedScene[] = [];

  async load() {
    try {
      this.scenes = ((await run('readonly', (s) => s.getAll())) as SavedScene[]).sort((a, b) => a.created - b.created);
    } catch (e) {
      console.warn('could not load saved scenes', e);
    }
  }

  get(id: string) {
    return this.scenes.find((s) => s.id === id);
  }

  async add(sc: Omit<SavedScene, 'id' | 'created'>) {
    const rec: SavedScene = { ...sc, id: Math.random().toString(36).slice(2, 10), created: Date.now() };
    await run('readwrite', (s) => s.put(rec));
    this.scenes.push(rec);
    return rec;
  }

  async remove(id: string) {
    await run('readwrite', (s) => s.delete(id));
    this.scenes = this.scenes.filter((s) => s.id !== id);
  }
}
