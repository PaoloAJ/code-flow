import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function handler(event: { key: string }) {
  // pretend to resize the image at event.key
  return { resized: event.key, client: s3.constructor.name };
}
