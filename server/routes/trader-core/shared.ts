import type { Express, NextFunction, Request, Response } from "express";

export type WsBroadcast = (event: any, filter?: (client: any) => boolean) => void;

export interface TraderCoreDeps {
  ensureAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
  ensureDoc1TermsAccepted: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
  broadcast: WsBroadcast;
}

export function broadcastTradesUpdated(broadcast: WsBroadcast, userId: number) {
  broadcast(
    { type: "trades:updated", userId },
    (client) => client.userId === userId || client.userId === undefined,
  );
}

export type { Express, Request, Response };
