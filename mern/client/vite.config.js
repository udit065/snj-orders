import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development (npm run dev) the API calls go to the Express server on port 8000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
