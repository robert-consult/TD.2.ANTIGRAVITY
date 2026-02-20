import type { Express } from "express";
import type { Server } from "http";
import { registerWsCore } from "../wsCore";
import type { RouterContext } from "../../context/routerContext";
import type { WsBroadcast } from "./wsContext";

export interface WsRuntime {
  httpServer: Server;
  broadcast: WsBroadcast;
}

export function initWebSocketServer(app: Express, ctx: RouterContext): WsRuntime {
  return registerWsCore(app, {
    sessionStore: ctx.sessionStore,
    sessionCookieName: ctx.sessionCookieName,
    sessionSecret: ctx.sessionSecret,
  });
}
