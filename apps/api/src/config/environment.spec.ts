import { observeOptions, parseCorsOrigins, validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  const valid = {
    JWT_SECRET: 'test-only-secret-at-least-32-characters',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  };

  it('accepts a minimal valid configuration and optional settings', () => {
    expect(validateEnvironment(valid)).toBe(valid);
    expect(() => validateEnvironment({
      ...valid, PORT: '8080', TRUST_PROXY: '1', CORS_ORIGINS: 'https://app.example.test, http://localhost:4200',
    })).not.toThrow();
  });

  it('validates the refresh cookie settings', () => {
    expect(() => validateEnvironment({
      ...valid, REFRESH_TOKEN_TTL_DAYS: '14', REFRESH_COOKIE_SECURE: 'false', REFRESH_COOKIE_PATH: '/api/auth',
    })).not.toThrow();
    expect(() => validateEnvironment({ ...valid, REFRESH_TOKEN_TTL_DAYS: '0' })).toThrow(/REFRESH_TOKEN_TTL_DAYS/);
    expect(() => validateEnvironment({ ...valid, REFRESH_COOKIE_SECURE: 'yes' })).toThrow(/REFRESH_COOKIE_SECURE/);
    expect(() => validateEnvironment({ ...valid, REFRESH_COOKIE_PATH: 'auth' })).toThrow(/REFRESH_COOKIE_PATH/);
  });

  it('validates the attachment storage settings', () => {
    const s3 = { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    expect(() => validateEnvironment({ ...valid, ...s3, S3_ENDPOINT: 'http://127.0.0.1:8333', S3_FORCE_PATH_STYLE: 'true' })).not.toThrow();
    expect(() => validateEnvironment({ ...valid, S3_BUCKET: 'b' })).toThrow(/S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
    expect(() => validateEnvironment({ ...valid, ...s3, S3_ENDPOINT: 'ftp://x' })).toThrow(/S3_ENDPOINT/);
    expect(() => validateEnvironment({ ...valid, ...s3, S3_PUBLIC_ENDPOINT: 'http://x/path' })).toThrow(/S3_PUBLIC_ENDPOINT/);
    expect(() => validateEnvironment({ ...valid, ...s3, S3_CREATE_BUCKET: 'yes' })).toThrow(/S3_CREATE_BUCKET/);
  });

  it('requires the Observe credentials as a pair', () => {
    expect(() => validateEnvironment({ ...valid, OBSERVE_APP_KEY: 'key' })).toThrow(/OBSERVE_APP_KEY/);
    expect(() => validateEnvironment({ ...valid, OBSERVE_APP_KEY: 'key', OBSERVE_APP_SECRET: 'secret' })).not.toThrow();
  });

  it('reports every invalid value at once', () => {
    expect(() => validateEnvironment({
      JWT_SECRET: 'short', DATABASE_URL: 'mysql://db', PORT: '70000', TRUST_PROXY: 'yes', CORS_ORIGINS: '*',
    })).toThrow(/JWT_SECRET[\s\S]*DATABASE_URL[\s\S]*PORT[\s\S]*TRUST_PROXY[\s\S]*CORS_ORIGINS/);
  });
});

describe('parseCorsOrigins', () => {
  it('accepts only the file mail provider outside production and a valid APP_URL', () => {
    const base = { JWT_SECRET: 'test-only-secret-at-least-32-characters' };
    expect(() => validateEnvironment({ ...base, MAIL_PROVIDER: 'file', APP_URL: 'https://app.example.test' })).not.toThrow();
    expect(() => validateEnvironment({ ...base, MAIL_PROVIDER: 'smtp' })).toThrow(/MAIL_PROVIDER/);
    expect(() => validateEnvironment({ ...base, MAIL_PROVIDER: 'file', NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
    expect(() => validateEnvironment({ ...base, APP_URL: 'app.example.test' })).toThrow(/APP_URL/);
    expect(() => validateEnvironment({ ...base, APP_URL: 'https://app.example.test/?x=1' })).toThrow(/APP_URL/);
  });

  it('accepts only the simulated billing provider, and never in production', () => {
    expect(() => validateEnvironment({ JWT_SECRET: 'test-only-secret-at-least-32-characters', BILLING_PROVIDER: 'fake' })).not.toThrow();
    expect(() => validateEnvironment({ JWT_SECRET: 'test-only-secret-at-least-32-characters', BILLING_PROVIDER: 'stripe' })).toThrow(/BILLING_PROVIDER/);
    expect(() => validateEnvironment({ JWT_SECRET: 'test-only-secret-at-least-32-characters', BILLING_PROVIDER: 'fake', NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
  });

  it('accepts the fixed Capacitor WebView origins but no other custom scheme', () => {
    expect(parseCorsOrigins('capacitor://localhost, https://localhost')).toEqual(['capacitor://localhost', 'https://localhost']);
    expect(() => parseCorsOrigins('capacitor://evil.example')).toThrow(/CORS_ORIGINS/);
  });

  it('returns no origins when unset so CORS stays disabled', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('  ')).toEqual([]);
  });

  it('accepts exact origins only', () => {
    expect(parseCorsOrigins('https://app.example.test,http://localhost:4200'))
      .toEqual(['https://app.example.test', 'http://localhost:4200']);
    for (const value of ['*', 'https://app.example.test/', 'https://app.example.test/path', 'ftp://files.example.test']) {
      expect(() => parseCorsOrigins(value)).toThrow(/CORS_ORIGINS/);
    }
  });
});

describe('observeOptions', () => {
  it('disables telemetry without credentials instead of using placeholders', () => {
    expect(observeOptions({})).toEqual({ enabled: false, serviceId: 'api' });
    expect(observeOptions({ OBSERVE_APP_KEY: ' ', OBSERVE_APP_SECRET: 'secret' })).toEqual({ enabled: false, serviceId: 'api' });
  });

  it('enables telemetry only with both credentials', () => {
    expect(observeOptions({ OBSERVE_APP_KEY: 'key', OBSERVE_APP_SECRET: 'secret' }))
      .toEqual({ enabled: true, appKey: 'key', appSecret: 'secret', serviceId: 'api' });
  });
});
