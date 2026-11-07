/**
 * Validação das variáveis de ambiente lidas na inicialização. Falhas impedem
 * a API de subir com uma configuração incoerente, em vez de falhar depois em
 * tempo de requisição.
 */
export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const text = (key: string): string | undefined => {
    const value = config[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const jwtSecret = text('JWT_SECRET');
  if (!jwtSecret || jwtSecret.length < 32) {
    errors.push('JWT_SECRET precisa ter pelo menos 32 caracteres.');
  }

  const databaseUrl = text('DATABASE_URL');
  if (databaseUrl && !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL precisa ser uma URL postgresql://.');
  }

  const port = text('PORT');
  if (port !== undefined && !isIntegerInRange(port, 1, 65535)) {
    errors.push('PORT precisa ser um inteiro entre 1 e 65535.');
  }

  const trustProxy = text('TRUST_PROXY');
  if (trustProxy !== undefined && !isIntegerInRange(trustProxy, 0, 10)) {
    errors.push('TRUST_PROXY precisa ser o número de proxies confiáveis, entre 0 e 10.');
  }

  const refreshDays = text('REFRESH_TOKEN_TTL_DAYS');
  if (refreshDays !== undefined && !isIntegerInRange(refreshDays, 1, 90)) {
    errors.push('REFRESH_TOKEN_TTL_DAYS precisa ser um inteiro entre 1 e 90.');
  }

  const cookieSecure = text('REFRESH_COOKIE_SECURE');
  if (cookieSecure !== undefined && cookieSecure !== 'true' && cookieSecure !== 'false') {
    errors.push('REFRESH_COOKIE_SECURE precisa ser true ou false.');
  }

  const cookiePath = text('REFRESH_COOKIE_PATH');
  if (cookiePath !== undefined && !/^\/[A-Za-z0-9/_-]*$/.test(cookiePath)) {
    errors.push('REFRESH_COOKIE_PATH precisa ser um caminho iniciado por /.');
  }

  if (Boolean(text('OBSERVE_APP_KEY')) !== Boolean(text('OBSERVE_APP_SECRET'))) {
    errors.push('OBSERVE_APP_KEY e OBSERVE_APP_SECRET devem ser definidas juntas.');
  }

  try {
    parseCorsOrigins(text('CORS_ORIGINS'));
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (errors.length > 0) {
    throw new Error(`Configuração de ambiente inválida:\n- ${errors.join('\n- ')}`);
  }
  return config;
}

/**
 * Converte `CORS_ORIGINS` (origens separadas por vírgula) em uma lista exata.
 * Sem valor, o CORS permanece desabilitado e a API atende apenas a mesma origem
 * ou um proxy reverso.
 */
export function parseCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`CORS_ORIGINS contém uma origem inválida: ${entry}`);
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== entry) {
      throw new Error(`CORS_ORIGINS deve conter apenas origens http(s) sem caminho ou barra final: ${entry}`);
    }
    return url.origin;
  });
}

/** Opções do NestJS Observe: habilitado somente com credenciais reais configuradas. */
export function observeOptions(env: Record<string, string | undefined>) {
  const appKey = env.OBSERVE_APP_KEY?.trim();
  const appSecret = env.OBSERVE_APP_SECRET?.trim();
  return appKey && appSecret
    ? { enabled: true, appKey, appSecret, serviceId: 'api' }
    : { enabled: false, serviceId: 'api' };
}

function isIntegerInRange(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return number >= min && number <= max;
}
