import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ibi-portfolio-manager/",
  plugins: [react()],
});
