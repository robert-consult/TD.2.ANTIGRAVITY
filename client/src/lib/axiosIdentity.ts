import axios, { AxiosHeaders } from "axios";
import { getIdentityHeaders } from "./identity";

let installed = false;

export function installAxiosIdentityHeaders() {
  if (installed) return;
  installed = true;

  axios.interceptors.request.use(async (config) => {
    const headers = await getIdentityHeaders();
    const merged = AxiosHeaders.from(config.headers ?? {});
    for (const [key, value] of Object.entries(headers)) {
      merged.set(key, value);
    }
    config.headers = merged;
    return config;
  });
}
