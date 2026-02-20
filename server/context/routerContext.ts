import type { NextFunction, Request, Response } from "express";
import type { Store } from "express-session";
import type { WebSocketServer } from "ws";

export type AppRouteMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void | Response | undefined> | void | Response;

export interface AppMiddleware {
  ensureAuth: AppRouteMiddleware;
  ensureDoc1TermsAccepted: AppRouteMiddleware;
}

export type WsBroadcast = (event: any, filter?: (client: any) => boolean) => void;

export interface RouterContext {
  sessionStore: Store;
  sessionCookieName: string;
  sessionSecret: string;
  middleware: AppMiddleware;
  wss?: WebSocketServer;
  wsBroadcast?: WsBroadcast;
}
