import { useTranslation } from "react-i18next";

/**
 * Form errors carry i18n keys (from Zod schemas or the API's fieldErrors), for example "validation.required".
 * Returns a translator that falls back to the raw text for older messages that aren't keys.
 */
export function useFieldError() {
  const { t, i18n } = useTranslation();
  return (message?: string) => (message ? (i18n.exists(message) ? t(message) : message) : undefined);
}
