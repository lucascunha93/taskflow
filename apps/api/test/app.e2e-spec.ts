import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

vi.mock('@nestjs/observe', () => {
  class ObserveStub {
    static forRoot() {
      return { module: ObserveStub };
    }
  }
  return {
    createObserveModule: () => ({ ObserveModule: ObserveStub, ObserveInstrument: undefined }),
  };
});

describe('AppModule HTTP wiring', () => {
  let app: INestApplication<App>;
  let queryRaw: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-only-secret-at-least-32-characters');
    queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET) reports database availability', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', database: 'connected' });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('/health (GET) reports database failures', async () => {
    queryRaw.mockRejectedValue(new Error('database unavailable'));
    await request(app.getHttpServer())
      .get('/health')
      .expect(503)
      .expect({ status: 'error', database: 'disconnected' });
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
});
