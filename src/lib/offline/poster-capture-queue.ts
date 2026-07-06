"use client";

// Local queue for poster verification photos taken while offline. Captures
// are held in IndexedDB (survives closing the app) until the user is back
// online and taps "Upload now" — nothing here ever talks to the network.

const DB_NAME = "ambassador-offline";
const DB_VERSION = 1;
const STORE_NAME = "poster-captures";
const CHANGE_EVENT = "poster-capture-queue-change";

export type PendingPosterCapture = {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function announceChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribes to queue changes made from anywhere in this tab. Returns an unsubscribe function. */
export function onPendingPosterCapturesChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export async function addPendingPosterCapture(
  capture: Omit<PendingPosterCapture, "id" | "capturedAt">,
): Promise<PendingPosterCapture> {
  const db = await openDb();
  const record: PendingPosterCapture = {
    ...capture,
    id: crypto.randomUUID(),
    capturedAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  announceChange();
  return record;
}

export async function listPendingPosterCaptures(): Promise<PendingPosterCapture[]> {
  const db = await openDb();
  const records = await new Promise<PendingPosterCapture[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as PendingPosterCapture[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records.sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function removePendingPosterCapture(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  announceChange();
}
