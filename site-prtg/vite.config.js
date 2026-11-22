import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // la liste des capteurs est lue dans ../backup/sensors.json
  server: { fs: { allow: ['..'] } },
})
