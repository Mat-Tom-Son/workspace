import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.WORKSPACE_LOCAL_API_PORT ?? "4327";

export default defineConfig({
  root: "web-local",
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: "../dist/web-local",
    emptyOutDir: true,
  },
});
