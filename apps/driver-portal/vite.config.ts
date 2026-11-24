import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, proxy: { '/api': { target: API_URL, ws: true } } },
  preview: { port: 4175, proxy: { '/api': { target: API_URL, ws: true } } },
});
