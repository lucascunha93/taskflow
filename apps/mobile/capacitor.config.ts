import type { CapacitorConfig } from '@capacitor/cli';

/**
 * TASKFLOW_CAP_LOCAL=1 (definido por `npm run android:local`) permite chamar a
 * API local por HTTP. Sem ele, o app só aceita HTTPS.
 */
const local = process.env['TASKFLOW_CAP_LOCAL'] === '1';

const config: CapacitorConfig = {
  appId: 'app.taskflow.mobile',
  appName: 'TaskFlow',
  webDir: 'dist/mobile/browser',
  server: local ? { cleartext: true } : undefined,
  android: {
    // O WebView usa https://localhost; a API local em http exige conteúdo misto.
    allowMixedContent: local,
  },
};

export default config;
