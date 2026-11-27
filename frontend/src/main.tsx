import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./styles.css";
import "./studio.css";
import { configureOfflineCaching } from "./offline";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void configureOfflineCaching(import.meta.env.BASE_URL)
      .catch(() => {
        /* The studio also works without offline caching. */
      });
  });
}
