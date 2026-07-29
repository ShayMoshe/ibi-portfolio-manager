import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ibi-portfolio-manager/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          charts: ["recharts"],
          xlsx: ["xlsx"],
        },
      },
    },
  },
});
