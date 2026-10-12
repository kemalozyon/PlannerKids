import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:demo` → Supabase olmadan çalışan tek dosyalık demo (dist-demo/index.html).
// .env'de Supabase anahtarları olsa bile demo derlemesine girmesin diye boşaltılır.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'demo' ? { outDir: 'dist-demo' } : undefined,
  define:
    mode === 'demo'
      ? { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' }
      : undefined,
}))
