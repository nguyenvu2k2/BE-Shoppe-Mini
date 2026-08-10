import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    DeleteObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import {
    S3_ALLOWED_FOLDERS,
    S3_ALLOWED_MIME_TYPES,
    S3_MAX_FILE_SIZE_BYTES,
    S3_MIME_TO_EXT,
    type S3AllowedMimeType,
    type S3Folder,
} from './s3.constants';

export type UploadedFile = {
    key: string;
    url: string;
    mimeType: string;
    size: number;
};

@Injectable()
export class FileService {
    private readonly logger = new Logger(FileService.name);
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly region: string;
    private readonly publicBaseUrl: string;

    constructor(private readonly configService: ConfigService) {
        const region = this.configService.getOrThrow<string>('AWS_REGION');
        const accessKeyId = this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.getOrThrow<string>(
            'AWS_SECRET_ACCESS_KEY',
        );

        this.region = region;
        this.bucket = this.configService.getOrThrow<string>('AWS_S3_BUCKET_NAME');
        this.publicBaseUrl =
            this.configService.get<string>('AWS_S3_PUBLIC_BASE_URL') ??
            `https://${this.bucket}.s3.${this.region}.amazonaws.com`;

        this.s3 = new S3Client({
            region,
            credentials: { accessKeyId, secretAccessKey },
        });
    }

    /**
     * Upload a multer file buffer to S3 under `{folder}/{uuid}.ext`.
     * Callers (UserService, CategoryService, …) only need folder + file.
     */
    async upload(
        file: Express.Multer.File,
        folder: S3Folder,
    ): Promise<UploadedFile> {
        this.assertValidUpload(file, folder);

        const ext = S3_MIME_TO_EXT[file.mimetype as S3AllowedMimeType];
        const key = `${folder}/${randomUUID()}.${ext}`;

        try {
            await this.s3.send(
                new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                    Body: file.buffer,
                    ContentType: file.mimetype,
                    // Public read via bucket policy (ACLs often disabled on modern buckets).
                }),
            );
        } catch (error) {
            this.logger.error(`S3 PutObject failed for key=${key}`, error);
            throw new InternalServerErrorException('Failed to upload file to S3');
        }

        const url = this.getPublicUrl(key);
        this.logger.log(`Uploaded s3://${this.bucket}/${key}`);

        return {
            key,
            url,
            mimeType: file.mimetype,
            size: file.size,
        };
    }

    /** Delete an object by key (e.g. when replacing an avatar). */
    async delete(key: string): Promise<void> {
        if (!key?.trim()) {
            throw new BadRequestException('S3 object key is required');
        }

        try {
            await this.s3.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            );
            this.logger.log(`Deleted s3://${this.bucket}/${key}`);
        } catch (error) {
            this.logger.error(`S3 DeleteObject failed for key=${key}`, error);
            throw new InternalServerErrorException('Failed to delete file from S3');
        }
    }

    /** Build the public URL for a stored key. */
    getPublicUrl(key: string): string {
        const base = this.publicBaseUrl.replace(/\/$/, '');
        return `${base}/${key}`;
    }

    /**
     * Extract object key from a full public URL of this bucket.
     * Returns null if the URL does not belong to our public base.
     */
    extractKeyFromUrl(url: string): string | null {
        const base = this.publicBaseUrl.replace(/\/$/, '') + '/';
        if (!url.startsWith(base)) {
            return null;
        }
        return url.slice(base.length) || null;
    }

    private assertValidUpload(file: Express.Multer.File, folder: S3Folder): void {
        if (!file?.buffer?.length) {
            throw new BadRequestException('File is required');
        }

        if (!S3_ALLOWED_FOLDERS.includes(folder)) {
            throw new BadRequestException(
                `Invalid folder. Allowed: ${S3_ALLOWED_FOLDERS.join(', ')}`,
            );
        }

        if (
            !S3_ALLOWED_MIME_TYPES.includes(file.mimetype as S3AllowedMimeType)
        ) {
            throw new BadRequestException(
                `Invalid file type. Allowed: ${S3_ALLOWED_MIME_TYPES.join(', ')}`,
            );
        }

        if (file.size > S3_MAX_FILE_SIZE_BYTES) {
            throw new BadRequestException(
                `File too large. Max size is ${S3_MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
            );
        }
    }
}
export { S3Folder };

