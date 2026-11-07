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

function isIntegerInRange(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return number >= min && number <= max;
}
