import type { Store } from "express-session";
import type { LiveClient } from "../wsCore";

export type { LiveClient } from "../wsCore";

export type WsBroadcast = (event: any, filter?: (client: LiveClient) => boolean) => void;

export interface WsInitDeps {
  sessionStore: Store;
  sessionCookieName: string;
  sessionSecret: string;
}
