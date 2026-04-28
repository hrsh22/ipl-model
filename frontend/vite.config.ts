import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const backendPort = process.env.API_PORT ?? process.env.PORT ?? "8080"
const backendTarget = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  plugins: [tanstackStart(), react()],
  server: {
    port: 3001,
    proxy: {
      "/observer": backendTarget,
      "/ready": backendTarget,
      "/health": backendTarget,
    },
  },
})
