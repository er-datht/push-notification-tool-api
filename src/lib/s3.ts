/**
 * The one S3Client for the whole process, and the one place a delivery CSV
 * is uploaded from.
 *
 * Credentials are not read here: the SDK's own default provider chain finds
 * them (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in the environment, a shared
 * ~/.aws/credentials file, or an IAM role) — env.ts only owns this app's own
 * config, not the SDK's credential lookup.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env.js";

const s3Client = new S3Client({ region: env.AWS_REGION });

export async function uploadCsvToS3(
  key: string,
  content: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Body: content,
      ContentType: "text/csv",
    }),
  );
}
