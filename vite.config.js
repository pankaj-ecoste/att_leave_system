import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Written once per build (here, not a separate script) so the constant baked into the
// client bundle below and the fetchable file always agree — a mismatch between them
// would make the app think a new version just shipped every time it loads (plan.md
// §20). The running app polls this plain, un-hashed file to notice a newer deploy
// while its tab/home-screen icon was already open.
const buildTime = Date.now()
fs.mkdirSync(path.resolve(__dirname, 'public'), { recursive: true })
fs.writeFileSync(path.resolve(__dirname, 'public/version.json'), JSON.stringify({ buildTime }))

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
})
