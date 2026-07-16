export type PdfDiscussionTurnStatus = 'idle' | 'running' | 'failed' | 'cancelled';

export type PdfDiscussionRect = [number, number, number, number];

export interface PdfDiscussionSelection {
  page: number;
  snippet?: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  rects: number[][];
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
}

export interface PdfDiscussionAnchorSnapshot {
  page: number;
  quote: string;
  prefix?: string;
  suffix?: string;
  rects: PdfDiscussionRect[];
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
}

export interface PdfDiscussionMessageSnapshot {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt: string;
  codexTurnId?: string;
}

export interface PdfDiscussionAnnotationSnapshot {
  id: string;
  kind: 'agent_discussion';
  selectionKey: string;
  anchor: PdfDiscussionAnchorSnapshot;
  snapshot?: {
    sha256: string;
    width: number;
    height: number;
    mimeType: 'image/png';
  };
  messages: PdfDiscussionMessageSnapshot[];
  summaryMarkdown?: string;
  lastTurn: {
    status: PdfDiscussionTurnStatus;
    questionMessageId?: string;
    error?: string;
  };
  promotion?: {
    threadId: string;
    promotedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type PdfDiscussionWebviewToHostMessage =
  | { type: 'pdfDiscussionPrepare'; requestId?: string; selection: PdfDiscussionSelection }
  | { type: 'pdfDiscussionList'; requestId?: string }
  | { type: 'pdfDiscussionOpen'; requestId?: string; annotationId: string }
  | { type: 'pdfDiscussionLoadSnapshot'; requestId?: string; annotationId: string }
  | {
      type: 'pdfDiscussionSubmit';
      requestId?: string;
      annotationId?: string;
      selection?: PdfDiscussionSelection;
      question: string;
      snapshotPngBase64?: string;
    }
  | { type: 'pdfDiscussionRetry'; requestId?: string; annotationId: string }
  | { type: 'pdfDiscussionCancel'; requestId?: string; annotationId: string }
  | { type: 'pdfDiscussionPromote'; requestId?: string; annotationId: string }
  | { type: 'pdfDiscussionOpenPromotedTask'; requestId?: string; annotationId: string }
  | {
      type: 'pdfDiscussionCopyPortableLink';
      requestId?: string;
      annotationId?: string;
      selection?: PdfDiscussionSelection;
    }
  | { type: 'pdfDiscussionOpenLink'; requestId?: string; href: string }
  | { type: 'pdfDiscussionConsent'; requestId?: string; accepted: boolean };

export type PdfDiscussionHostToWebviewMessage =
  | {
      type: 'pdfDiscussionSnapshot';
      annotations: PdfDiscussionAnnotationSnapshot[];
      consentGranted: boolean;
      activeAnnotationId?: string;
      requestId?: string;
    }
  | {
      type: 'pdfDiscussionSnapshotImage';
      annotationId: string;
      snapshotPngBase64?: string;
      requestId?: string;
    }
  | {
      type: 'pdfDiscussionHighlights';
      highlights: Array<{
        annotationId: string;
        page: number;
        rects: PdfDiscussionRect[];
        status: PdfDiscussionTurnStatus;
        summaryMarkdown?: string;
      }>;
    }
  | {
      type: 'pdfDiscussionPrepared';
      selectionKey: string;
      annotation?: PdfDiscussionAnnotationSnapshot;
      requestId?: string;
    }
  | { type: 'pdfDiscussionDelta'; annotationId: string; delta: string }
  | {
      type: 'pdfDiscussionTurnState';
      annotationId: string;
      status: PdfDiscussionTurnStatus;
      error?: string;
    }
  | {
      type: 'pdfDiscussionPromotionState';
      annotationId: string;
      threadId: string;
      opened: boolean;
      error?: string;
      requestId?: string;
    }
  | {
      type: 'pdfDiscussionPortableLinkCopied';
      annotationId?: string;
      requestId?: string;
    }
  | { type: 'pdfDiscussionOpenForSelection' }
  | { type: 'pdfDiscussionError'; message: string; requestId?: string; annotationId?: string };
