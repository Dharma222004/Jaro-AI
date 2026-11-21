'use client';

const DATABASE = 'jaro-attachments-v1';
const STORE = 'images';

export async function storeAttachment(id: string, blob: Blob) {
  const db = await openDatabase();
  await transaction(db, 'readwrite', (store) => store.put({ id, blob, createdAt: Date.now() }));
}

export async function getAttachment(id: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result?.blob instanceof Blob ? request.result.blob : null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAttachment(id: string) {
  const db = await openDatabase();
  await transaction(db, 'readwrite', (store) => store.delete(id));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
