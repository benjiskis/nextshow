// vite.config.js — v0.1.0
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/nextshow/' matches GitHub Pages project-site path.
// Update if the repo name differs.
export default defineConfig({
  plugins: [react()],
  base: '/nextshow/',
})
