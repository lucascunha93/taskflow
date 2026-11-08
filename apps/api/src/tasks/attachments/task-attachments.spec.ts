import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '../../generated/prisma/client.js';
import { ActivityService } from '../../activity/activity.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { contentDisposition, ObjectStorageService } from '../../storage/object-storage.service.js';
import { ATTACHMENT_MAX_BYTES, attachmentContentType, sanitizeFileName } from './file-policy.js';
import { TaskAttachmentsController } from './task-attachments.controller.js';
import { TaskAttachmentsService } from './task-attachments.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');

describe('attachment file policy', () => {
  it('accepts allowed types only when the content matches the extension', () => {
    expect(attachmentContentType('foto.PNG', PNG)).toBe('image/png');
    expect(attachmentContentType('contrato.pdf', PDF)).toBe('application/pdf');
    expect(attachmentContentType('notas.csv', Buffer.from('a;b\n1;2\n'))).toBe('text/csv; charset=utf-8');
    expect(attachmentContentType('planilha.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toContain('spreadsheetml');
    for (const [name, bytes] of [
      ['pagina.html', Buffer.from('<script>alert(1)</script>')],
      ['desenho.svg', Buffer.from('<svg onload="x()"/>')],
      ['programa.exe', Buffer.from('MZ')],
      ['sem-extensao', PNG],
    ] as const) {
      expect(() => attachmentContentType(name, bytes)).toThrow(/não permitido/);
    }
    expect(() => attachmentContentType('falso.png', PDF)).toThrow(/não corresponde/);
    expect(() => attachmentContentType('binario.txt', Buffer.from([0x61, 0x00, 0x62]))).toThrow(/não corresponde/);
    expect(() => attachmentContentType('vazio.pdf', Buffer.alloc(0))).toThrow(/não corresponde/);
  });

  it('strips paths and control characters, keeps UTF-8 names and the extension when truncating', () => {
    expect(sanitizeFileName('..\\..\\etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFileName('rel\u0000at\u001fório.pdf')).toBe('relatório.pdf');
    expect(sanitizeFileName(Buffer.from('relatório.pdf', 'utf8').toString('latin1'))).toBe('relatório.pdf');
    const long = sanitizeFileName(`${'a'.repeat(300)}.pdf`);
    expect(long).toHaveLength(255);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('builds an attachment disposition with ASCII fallback and encoded UTF-8 name', () => {
    expect(contentDisposition('relatório "final".pdf'))
      .toBe('attachment; filename="relatorio _final_.pdf"; filename*=UTF-8\'\'relat%C3%B3rio%20%22final%22.pdf');
  });
});

describe('TaskAttachmentsController (HTTP)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const attachmentId = '44444444-4444-4444-8444-444444444444';
  let app: INestApplication;
  let token: string;
  let configured = true;
  const storage = {
    isConfigured: () => configured,
    put: vi.fn().mockResolvedValue(undefined),
    deleteQuietly: vi.fn().mockResolvedValue(undefined),
    downloadUrl: vi.fn().mockResolvedValue({ url: 'https://s3.example.test/signed', expiresAt: new Date('2030-01-01T00:00:00Z') }),
  };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    membership: { findUnique: ReturnType<typeof vi.fn> };
    task: { findFirst: ReturnType<typeof vi.fn> };
    taskAttachment: {
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
  const created = { id: attachmentId, taskId, fileName: 'foto.png', contentType: 'image/png', size: PNG.length, createdAt: new Date(), uploader: { id: userId, name: 'U' } };

  beforeEach(async () => {
    configured = true;
    vi.clearAllMocks();
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ sessionVersion: 0 }) },
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
      task: { findFirst: vi.fn().mockResolvedValue({ title: 'Tarefa' }) },
      taskAttachment: {
        count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue(created),
        findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: (callback) => callback(prisma),
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-only-signing-key-not-used-in-production' })],
      controllers: [TaskAttachmentsController],
      providers: [
        TaskAttachmentsService, JwtAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: ObjectStorageService, useValue: storage },
        { provide: ActivityService, useValue: activity },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = await app.get(JwtService).signAsync({ sub: userId });
  });

  afterEach(async () => {
    await app.close();
  });

  const url = `/organizations/${orgId}/tasks/${taskId}/attachments`;
  const upload = (buffer: Buffer, name: string) =>
    request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).attach('file', buffer, name);

  it('stores a valid upload under a server-generated key and records history', async () => {
    const response = await upload(PNG, 'foto.png').expect(201);
    expect(response.body).toMatchObject({ id: attachmentId, fileName: 'foto.png', contentType: 'image/png' });
    const [key, body, type] = storage.put.mock.calls[0] as [string, Buffer, string];
    expect(key).toMatch(new RegExp(`^organizations/${orgId}/tasks/${taskId}/[0-9a-f-]{36}$`));
    expect(body.equals(PNG)).toBe(true);
    expect(type).toBe('image/png');
    expect(activity.record).toHaveBeenCalledWith(prisma, expect.objectContaining({
      type: 'ATTACHMENT_ADDED', changes: [{ field: 'attachment', from: null, to: 'foto.png' }],
    }));
  });

  it('rejects oversized, disallowed, mismatched and missing files before storing', async () => {
    await upload(Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES)]), 'grande.png').expect(413);
    await upload(Buffer.from('<html></html>'), 'pagina.html').expect(415);
    await upload(PDF, 'foto.png').expect(415);
    await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).field('other', 'x').expect(400);
    await request(app.getHttpServer()).post(url).attach('file', PNG, 'foto.png').expect(401);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('answers 503 when storage is not configured and 409 when the task is full', async () => {
    configured = false;
    await upload(PNG, 'foto.png').expect(503);
    configured = true;
    prisma.taskAttachment.count.mockResolvedValue(20);
    await upload(PNG, 'foto.png').expect(409);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('removes the stored object when the database write fails', async () => {
    prisma.taskAttachment.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }));
    await upload(PNG, 'foto.png').expect(404);
    expect(storage.deleteQuietly).toHaveBeenCalledWith([(storage.put.mock.calls[0] as [string])[0]]);
  });

  it('hides other tenants and returns signed download URLs', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`).expect(404);
    prisma.taskAttachment.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer()).get(`${url}/${attachmentId}/download`).set('Authorization', `Bearer ${token}`).expect(404);
    prisma.taskAttachment.findFirst.mockResolvedValue({ id: attachmentId, fileName: 'foto.png', contentType: 'image/png', storageKey: 'k', uploaderId: userId });
    const response = await request(app.getHttpServer()).get(`${url}/${attachmentId}/download`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body).toEqual({ url: 'https://s3.example.test/signed', expiresAt: '2030-01-01T00:00:00.000Z' });
    expect(storage.downloadUrl).toHaveBeenCalledWith('k', 'foto.png', 'image/png');
  });

  it('lets only the uploader, OWNER or ADMIN delete, and removes the object afterwards', async () => {
    prisma.taskAttachment.findFirst.mockResolvedValue({ id: attachmentId, fileName: 'foto.png', contentType: 'image/png', storageKey: 'k', uploaderId: 'someone-else' });
    await request(app.getHttpServer()).delete(`${url}/${attachmentId}`).set('Authorization', `Bearer ${token}`).expect(403);
    expect(prisma.taskAttachment.deleteMany).not.toHaveBeenCalled();
    prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await request(app.getHttpServer()).delete(`${url}/${attachmentId}`).set('Authorization', `Bearer ${token}`).expect(204);
    expect(storage.deleteQuietly).toHaveBeenCalledWith(['k']);
    expect(activity.record).toHaveBeenCalledWith(prisma, expect.objectContaining({ type: 'ATTACHMENT_REMOVED' }));
  });
});
