/** Navegador (ng serve): a API é acessada pelo proxy de desenvolvimento, na mesma origem. */
export const environment = {
  apiBaseUrl: '',
  /** DSN do projeto no GlitchTip/Sentry (é público por natureza); vazio desliga a captura de erros. */
  sentryDsn: '',
  sentryEnvironment: 'development',
};
