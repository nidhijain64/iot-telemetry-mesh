import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsConfig =
    env.SSL_KEY_PATH && env.SSL_CERT_PATH
      ? { key: fs.readFileSync(env.SSL_KEY_PATH), cert: fs.readFileSync(env.SSL_CERT_PATH) }
      : undefined;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true, // listen on all network interfaces, not just localhost — required for phone access
      https: httpsConfig,
    },
  };
});
