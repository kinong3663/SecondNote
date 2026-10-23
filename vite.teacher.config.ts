import { defineConfig } from 'vite';

// 只构建教师端一个页，产物挂在秒记卡的 Express 上：/teacher
// base 必须是 /teacher/，否则静态资源和观众端的 /assets 撞车。
export default defineConfig({
  base: '/teacher/',
  build: {
    outDir: 'dist-teacher',
    emptyOutDir: true,
    rollupOptions: {
      input: { teacher: 'teacher.html' },
    },
  },
});
