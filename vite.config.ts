import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:demo` → Supabase olmadan çalışan tek dosyalık demo (dist-demo/index.html).
// .env'de Supabase anahtarları olsa bile demo derlemesine girmesin diye boşaltılır.
// Klasör adı sabitte durur: Railway'in Railpack'i çıktı klasörünü bu dosyada outDir'e yazılmış tırnaklı metinden okur
// (regex). Metin doğrudan orada olsaydı normal derlemede de dist-demo'yu arar, "/app/dist-demo not found" ile düşerdi.
const DEMO_OUT = 'dist-demo'

export default defineConfig(({ mode }) => ({
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  // Normal derlemede küçük .glb'ler de JS'e gömülmez: 3D parçası küçülür, yalnızca odada kullanılan modeller iner.
  // Demo tek dosya kalmalı (vite-plugin-singlefile her şeyi gömer).
  build: mode === 'demo' ? { outDir: DEMO_OUT } : { assetsInlineLimit: (file: string) => (file.endsWith('.glb') ? false : undefined) },
  define:
    mode === 'demo'
      ? { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' }
      : undefined,
}))
