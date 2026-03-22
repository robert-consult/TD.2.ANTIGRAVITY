import { normalizeAppBaseUrl } from "@shared/appSurfaceConfig";
import { resolveWsUrl } from "@shared/ws/protocol";
import { getApiBaseUrl } from "./appUrl";

export function getWsUrl(): string {
  const explicitWsBaseUrl = normalizeAppBaseUrl((import.meta as any).env?.VITE_WS_URL);
  const configuredBaseUrl = explicitWsBaseUrl ?? getApiBaseUrl();
  const baseUrl = configuredBaseUrl || window.location.origin;
  return resolveWsUrl(baseUrl);
}
