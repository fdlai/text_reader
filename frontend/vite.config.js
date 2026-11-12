import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  // Tests (npm test) run in jsdom, a browser page simulated in Node.
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.js"],
    // npm run test:coverage: which lines the tests run.
    coverage: {
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/**/*.test.{js,jsx}", "src/test/**", "src/main.jsx"],
    },
  },
});
