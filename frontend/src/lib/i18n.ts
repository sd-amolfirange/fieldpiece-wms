import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";

// Section 12: every UI string lives in src/locales. es/fr fall back to en until translated. [CONFIRM languages]

export const supportedLanguages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
] as const;

export type LanguageCode = (typeof supportedLanguages)[number]["code"];

function initialLanguage(): LanguageCode {
  try {
    const saved = window.localStorage.getItem("wms-lang");
    if (saved && supportedLanguages.some((l) => l.code === saved)) return saved as LanguageCode;
  } catch {
    // storage blocked: fall through to the browser language
  }
  const browser = typeof navigator !== "undefined" ? navigator.language.split("-")[0] : "en";
  return supportedLanguages.some((l) => l.code === browser) ? (browser as LanguageCode) : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, fr: { translation: fr } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    window.localStorage.setItem("wms-lang", lng);
  } catch {
    // ignore: preference just won't persist
  }
});

export { i18n };
