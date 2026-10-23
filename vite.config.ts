import { defineConfig } from 'vite';

// 两个入口：观众/场次复盘（index.html）与教师端复盘台（teacher.html）
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        teacher: 'teacher.html',
      },
    },
  },
});
