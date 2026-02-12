import { parseLegacyDateInput } from "@shared/time/instant";

/* Converts various date formats to a Date object */
export default function parseDate(str: string | number) {
  try {
    return parseLegacyDateInput(str);
  } catch (error) {
    console.error("Error parsing date:", error);
    return null;
  }
}
