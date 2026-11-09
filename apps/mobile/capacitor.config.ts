import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.taskflow.mobile',
  appName: 'TaskFlow',
  webDir: 'dist/mobile/browser',
  android: {
    // Sem tráfego HTTP em claro; a API deve ser servida por HTTPS.
    allowMixedContent: false,
  },
};

export default config;
