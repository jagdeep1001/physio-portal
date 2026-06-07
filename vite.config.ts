import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When deploying to GitHub Pages set VITE_BASE_PATH to '/your-repo-name/'
// For Vercel / Netlify / custom domain leave it unset (defaults to '/')
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? '/',
});
