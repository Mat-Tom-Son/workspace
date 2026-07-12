import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";
import "./professional-foundation.css";
import "./professional-shell.css";
import "./professional-surfaces.css";
import "./professional-customization.css";
import { App } from "./App";

if (window.workspaceDesktop?.window.material === "mica") {
  document.documentElement.dataset.windowMaterial = "mica";
} else {
  delete document.documentElement.dataset.windowMaterial;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
