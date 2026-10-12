import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 로컬 개발: /api 요청을 Express 서버로 전달
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    rollupOptions: {
      output: {
        // Firebase는 별도 청크로(캐시 효율). 차트(recharts)는 대시보드 지연 로딩 시에만 받는다.
        manualChunks: { firebase: ['firebase/app', 'firebase/auth'] },
      },
    },
  },
});
