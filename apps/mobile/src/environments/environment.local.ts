/**
 * Build nativo para testes locais (`npm run android:local`), com a API rodando
 * no seu computador em http://<host>:3000.
 *
 * - Emulador Android: 10.0.2.2 é o endereço do computador visto pelo emulador.
 * - Celular físico na mesma rede Wi-Fi: troque pelo IP do computador
 *   (ex.: http://192.168.0.10:3000) e libere a porta 3000 no firewall.
 *
 * Este build permite HTTP sem TLS e nunca deve ser distribuído.
 */
export const environment = {
  apiBaseUrl: 'http://10.0.2.2:3000',
  /** DSN do projeto no GlitchTip/Sentry (é público por natureza); vazio desliga a captura de erros. */
  sentryDsn: '',
  sentryEnvironment: 'mobile-local',
};
