import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Validade das URLs de download assinadas. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

interface StorageSettings {
  bucket: string;
  /** Cliente das operações da API (endpoint interno). */
  client: S3Client;
  /** Cliente usado apenas para assinar URLs com o endereço acessível pelo navegador. */
  signer: S3Client;
  createBucket: boolean;
}

/**
 * Armazenamento de objetos compatível com S3 (AWS S3, Cloudflare R2, MinIO,
 * SeaweedFS e outros). Sem configuração, os recursos que dependem dele
 * respondem 503 e o restante da API funciona normalmente.
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly settings: StorageSettings | null;

  constructor(config: ConfigService) {
    const bucket = config.get<string>('S3_BUCKET');
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.settings = null;
      return;
    }
    const region = config.get<string>('S3_REGION') || 'us-east-1';
    const endpoint = config.get<string>('S3_ENDPOINT') || undefined;
    const publicEndpoint = config.get<string>('S3_PUBLIC_ENDPOINT') || endpoint;
    const forcePathStyle = config.get<string>('S3_FORCE_PATH_STYLE') === 'true';
    const credentials = { accessKeyId, secretAccessKey };
    const client = new S3Client({ region, endpoint, forcePathStyle, credentials });
    this.settings = {
      bucket,
      client,
      signer: publicEndpoint === endpoint ? client : new S3Client({ region, endpoint: publicEndpoint, forcePathStyle, credentials }),
      createBucket: config.get<string>('S3_CREATE_BUCKET') === 'true',
    };
  }

  isConfigured(): boolean {
    return this.settings !== null;
  }

  /** Em desenvolvimento, `S3_CREATE_BUCKET=true` cria o bucket ausente na inicialização. */
  async onModuleInit(): Promise<void> {
    if (!this.settings?.createBucket) return;
    const { client, bucket } = this.settings;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log(`Bucket ${bucket} criado.`);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length,
    }));
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Remove objetos sem interromper o fluxo chamador: falhas ficam registradas
   * no log, pois o registro no banco já deixou de existir.
   */
  async deleteQuietly(keys: string[]): Promise<void> {
    if (keys.length === 0 || !this.settings) return;
    const { client, bucket } = this.settings;
    try {
      for (let index = 0; index < keys.length; index += 1000) {
        const batch = keys.slice(index, index + 1000);
        const result = await client.send(new DeleteObjectsCommand({
          Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }));
        for (const error of result.Errors ?? []) {
          this.logger.warn(`Objeto não removido do armazenamento: ${error.Key ?? '?'} (${error.Code ?? 'erro'})`);
        }
      }
    } catch (error: unknown) {
      this.logger.warn(`Falha ao remover ${keys.length} objeto(s) do armazenamento: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** URL temporária que baixa o objeto como anexo, com o nome original. */
  async downloadUrl(key: string, fileName: string, contentType: string): Promise<{ url: string; expiresAt: Date }> {
    const { signer, bucket } = this.require();
    const url = await getSignedUrl(signer, new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(fileName),
      ResponseContentType: contentType,
    }), { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
  }

  private require(): StorageSettings {
    if (!this.settings) {
      throw new ServiceUnavailableException('O armazenamento de anexos não está configurado.');
    }
    return this.settings;
  }
}

/** `attachment` com nome ASCII de reserva e o nome UTF-8 (RFC 6266/5987). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii || 'arquivo'}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
