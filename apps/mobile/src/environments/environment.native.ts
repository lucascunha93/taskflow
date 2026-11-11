/**
 * Build para o app nativo (Capacitor). O WebView não tem proxy: informe a URL
 * pública da API, em HTTPS, e inclua as origens do app em CORS_ORIGINS da API
 * (capacitor://localhost no iOS e https://localhost no Android).
 */
export const environment = {
  apiBaseUrl: 'https://api.taskflow.example',
  /** DSN do projeto no GlitchTip/Sentry (é público por natureza); vazio desliga a captura de erros. */
  sentryDsn: '',
  sentryEnvironment: 'mobile',
};
