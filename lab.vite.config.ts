import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'output/lab-build',rollupOptions:{input:{lab:'lab.html',qa:'qa.html'}}}});
