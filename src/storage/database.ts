import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  TranslationSegment,
  TranslationSession,
} from "../types";

interface TraductorSchema extends DBSchema {
  sessions: {
    key: string;
    value: TranslationSession;
    indexes: {
      "by-started-at": number;
    };
  };
  segments: {
    key: string;
    value: TranslationSegment;
    indexes: {
      "by-session": string;
      "by-session-sequence": [string, number];
    };
  };
}

const DATABASE_NAME = "traductor";
const DATABASE_VERSION = 1;
let databasePromise: Promise<IDBPDatabase<TraductorSchema>> | undefined;

export function getDatabase(): Promise<IDBPDatabase<TraductorSchema>> {
  databasePromise ??= openDB<TraductorSchema>(
    DATABASE_NAME,
    DATABASE_VERSION,
    {
      upgrade(database) {
        const sessions = database.createObjectStore("sessions", {
          keyPath: "id",
        });
        sessions.createIndex("by-started-at", "startedAt");

        const segments = database.createObjectStore("segments", {
          keyPath: "id",
        });
        segments.createIndex("by-session", "sessionId");
        segments.createIndex("by-session-sequence", [
          "sessionId",
          "sequence",
        ]);
      },
    },
  );

  return databasePromise;
}

export async function saveSession(
  session: TranslationSession,
): Promise<void> {
  const database = await getDatabase();
  await database.put("sessions", session);
}

export async function getSession(
  sessionId: string,
): Promise<TranslationSession | undefined> {
  const database = await getDatabase();
  return database.get("sessions", sessionId);
}

export async function listSessions(
  limit = 50,
): Promise<TranslationSession[]> {
  const database = await getDatabase();
  const sessions = await database.getAllFromIndex(
    "sessions",
    "by-started-at",
  );
  return sessions.slice(-limit).reverse();
}

export async function saveSegment(
  segment: TranslationSegment,
): Promise<void> {
  const database = await getDatabase();
  await database.put("segments", segment);
}

export async function listSegments(
  sessionId: string,
): Promise<TranslationSegment[]> {
  const database = await getDatabase();
  return database.getAllFromIndex(
    "segments",
    "by-session-sequence",
    IDBKeyRange.bound(
      [sessionId, 0],
      [sessionId, Number.MAX_SAFE_INTEGER],
    ),
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ["sessions", "segments"],
    "readwrite",
  );
  const segmentKeys = await transaction
    .objectStore("segments")
    .index("by-session")
    .getAllKeys(sessionId);

  await Promise.all([
    ...segmentKeys.map((key) =>
      transaction.objectStore("segments").delete(key),
    ),
    transaction.objectStore("sessions").delete(sessionId),
  ]);
  await transaction.done;
}

export async function resetDatabaseForTests(): Promise<void> {
  const database = await getDatabase();
  database.close();
  databasePromise = undefined;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    request.onblocked = () => reject(new Error("Database deletion blocked"));
  });
}
