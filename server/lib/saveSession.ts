import type session from "express-session";

type PersistableSession = session.Session & Partial<session.SessionData>;

export async function saveSession(currentSession: PersistableSession): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    currentSession.save((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}
