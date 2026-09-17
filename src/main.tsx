import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import plTranslation from "./locales/pl.json";
import enTranslation from "./locales/en.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      pl: { translation: plTranslation },
      en: { translation: enTranslation }
    },
    lng: "pl", // default to Polish
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
