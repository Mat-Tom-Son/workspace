import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";
import "./professional-foundation.css";
import "./professional-shell.css";
import "./professional-surfaces.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
