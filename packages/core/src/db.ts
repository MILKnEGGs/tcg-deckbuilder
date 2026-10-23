// Local storage. Decks live in this browser's IndexedDB, one database per game; nothing is sent anywhere.

import type { Deck } from './types';

let dbp: Promise<IDBDatabase> | undefined;
let dbName = 'milks-decks';

/** Call once at startup, before any other function here. */
export function useDatabase(game: string): void {
  dbName = `milks-${game}-decks`;
  dbp = undefined;
}

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('decks', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction('decks', mode);
        const req = fn(tx.objectStore('decks'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const listDecks = () => run<Deck[]>('readonly', (s) => s.getAll());
export const getDeck = (id: string) => run<Deck | undefined>('readonly', (s) => s.get(id));
// $state proxies can't be structured-cloned; store a plain copy.
export const putDeck = (d: Deck) => run('readwrite', (s) => s.put(JSON.parse(JSON.stringify(d))));
export const deleteDeck = (id: string) => run('readwrite', (s) => s.delete(id));

/** Asks the browser not to evict our data when storage runs low (best effort). */
export function requestPersistence(): void {
  navigator.storage?.persist?.().catch(() => {});
}
