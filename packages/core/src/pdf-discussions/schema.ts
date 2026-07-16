import { isAbsolute, win32 } from 'path';
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PdfCoordinateSchema = z.number().finite();

function isRelativeAssetPath(value: string): boolean {
  if (isAbsolute(value) || win32.isAbsolute(value)) return false;
  const parts = value.replace(/\\/g, '/').split('/');
  return parts.length > 0 && parts.every(part => part !== '' && part !== '.' && part !== '..');
}

export function pdfDiscussionSnapshotFile(annotationId: string): string {
  return `assets/${annotationId}/selection.png`;
}

export const PdfDiscussionRectV1Schema = z.tuple([
  PdfCoordinateSchema,
  PdfCoordinateSchema,
  PdfCoordinateSchema,
  PdfCoordinateSchema,
]);

export const PdfDiscussionAnchorV1Schema = z.object({
  uri: NonEmptyStringSchema,
  page: z.number().int().positive(),
  quote: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  rects: z.array(PdfDiscussionRectV1Schema),
  textItemIndex: z.number().int().nonnegative().optional(),
  charOffset: z.number().int().nonnegative().optional(),
  endTextItemIndex: z.number().int().nonnegative().optional(),
  endCharOffset: z.number().int().nonnegative().optional(),
  portableUrl: NonEmptyStringSchema,
});

export const PdfDiscussionSnapshotV1Schema = z.object({
  file: NonEmptyStringSchema.refine(isRelativeAssetPath, 'Snapshot file must be a relative path'),
  sha256: Sha256Schema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.literal('image/png'),
});

export const PdfDiscussionMessageV1Schema = z.object({
  id: NonEmptyStringSchema,
  role: z.enum(['user', 'assistant']),
  markdown: z.string(),
  createdAt: NonEmptyStringSchema,
  codexTurnId: NonEmptyStringSchema.optional(),
  codexModel: NonEmptyStringSchema.optional(),
});

export const PdfDiscussionLastTurnV1Schema = z.object({
  status: z.enum(['idle', 'running', 'failed', 'cancelled']),
  questionMessageId: NonEmptyStringSchema.optional(),
  model: NonEmptyStringSchema.optional(),
  error: NonEmptyStringSchema.optional(),
  ownerId: NonEmptyStringSchema.optional(),
  ownerPid: z.number().int().positive().optional(),
  startedAt: NonEmptyStringSchema.optional(),
});

export const PdfDiscussionPromotionV1Schema = z.object({
  threadId: NonEmptyStringSchema,
  promotedAt: NonEmptyStringSchema,
});

export const PdfDiscussionPromotionAttemptV1Schema = z.object({
  id: NonEmptyStringSchema,
  status: z.enum(['starting', 'seeding', 'failed']),
  ownerId: NonEmptyStringSchema,
  ownerPid: z.number().int().positive(),
  startedAt: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema.optional(),
  error: NonEmptyStringSchema.optional(),
});

export const PdfDiscussionAnnotationV1Schema = z.object({
  id: NonEmptyStringSchema,
  kind: z.literal('agent_discussion'),
  selectionKey: NonEmptyStringSchema,
  anchorId: NonEmptyStringSchema.optional(),
  anchor: PdfDiscussionAnchorV1Schema,
  snapshot: PdfDiscussionSnapshotV1Schema.optional(),
  messages: z.array(PdfDiscussionMessageV1Schema),
  summaryMarkdown: z.string().optional(),
  lastTurn: PdfDiscussionLastTurnV1Schema,
  promotion: PdfDiscussionPromotionV1Schema.optional(),
  promotionAttempt: PdfDiscussionPromotionAttemptV1Schema.optional(),
  createdAt: NonEmptyStringSchema,
  updatedAt: NonEmptyStringSchema,
}).superRefine((annotation, context) => {
  if (!annotation.snapshot) return;
  const canonicalFile = pdfDiscussionSnapshotFile(annotation.id);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(annotation.id)
    || annotation.snapshot.file !== canonicalFile
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snapshot', 'file'],
      message: `Snapshot file must use the canonical annotation path: ${canonicalFile}`,
    });
  }
});

export const PdfDiscussionDocumentV1Schema = z.object({
  version: z.literal(1),
  source: z.object({
    uri: NonEmptyStringSchema,
    sha256: Sha256Schema,
  }),
  annotations: z.array(PdfDiscussionAnnotationV1Schema),
});

export type PdfDiscussionRectV1 = z.infer<typeof PdfDiscussionRectV1Schema>;
export type PdfDiscussionAnchorV1 = z.infer<typeof PdfDiscussionAnchorV1Schema>;
export type PdfDiscussionSnapshotV1 = z.infer<typeof PdfDiscussionSnapshotV1Schema>;
export type PdfDiscussionMessageV1 = z.infer<typeof PdfDiscussionMessageV1Schema>;
export type PdfDiscussionLastTurnV1 = z.infer<typeof PdfDiscussionLastTurnV1Schema>;
export type PdfDiscussionPromotionV1 = z.infer<typeof PdfDiscussionPromotionV1Schema>;
export type PdfDiscussionPromotionAttemptV1 = z.infer<typeof PdfDiscussionPromotionAttemptV1Schema>;
export type PdfDiscussionAnnotationV1 = z.infer<typeof PdfDiscussionAnnotationV1Schema>;
export type PdfDiscussionDocumentV1 = z.infer<typeof PdfDiscussionDocumentV1Schema>;
