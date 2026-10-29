import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Временно меняем адрес и добавляем base для корректных путей
  site: 'https://Spr2122.github.io',
  base: '/SorbetOPT_test2', 
  
  output: 'static',
  integrations: [sitemap()],
  build: {
    format: 'directory'
  }
});
