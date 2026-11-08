import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base "./" keeps asset paths relative, so the built app also works when
// served from any folder. Routing uses the URL hash for the same reason.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
