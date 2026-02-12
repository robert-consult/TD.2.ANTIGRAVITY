import axios, { AxiosHeaders } from "axios";
import { getIdentityHeaders } from "./identity";
import { getApiBaseUrl } from "./appUrl";
import { CSRF_HEADER_NAME } from "@shared/security/csrf";
import {
  getCsrfTokenForUrl,
  isCsrfFailurePayload,
  refreshCsrfToken,
  shouldAttachCsrfToUrl,
} from "./csrf";

let installed = false;

export function installAxiosIdentityHeaders() {
  if (installed) return;
  installed = true;

  axios.defaults.baseURL = getApiBaseUrl();
  axios.defaults.withCredentials = true;

  axios.interceptors.request.use(async (config) => {
    const headers = await getIdentityHeaders();
    const merged = AxiosHeaders.from(config.headers ?? {});
    for (const [key, value] of Object.entries(headers)) {
      merged.set(key, value);
    }

    const csrfToken = await getCsrfTokenForUrl(config.url, config.method);
    if (csrfToken) {
      merged.set(CSRF_HEADER_NAME, csrfToken);
    }

    config.headers = merged;
    return config;
  });

  axios.interceptors.response.use(
    (response) => response,
    async (error: any) => {
      const response = error?.response;
      const config = error?.config;
      if (!response || !config) throw error;
      if ((config as any).__csrfRetried) throw error;
      if (!isCsrfFailurePayload(response.data)) throw error;
      if (!shouldAttachCsrfToUrl(config.url, config.method)) throw error;

      await refreshCsrfToken();
      const retryToken = await getCsrfTokenForUrl(config.url, config.method, { forceRefresh: true });
      if (!retryToken) throw error;

      const merged = AxiosHeaders.from(config.headers ?? {});
      merged.set(CSRF_HEADER_NAME, retryToken);
      (config as any).__csrfRetried = true;
      config.headers = merged;
      return axios(config);
    },
  );
}
