export const EXPERIMENTAL_BROWSER_VIEW_TYPE = 'llm-wiki.experimentalOwnedBrowser';
export const EXPERIMENTAL_BROWSER_BUNDLE = 'experimental-owned-browser.js';
export const EXPERIMENTAL_BROWSER_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const EXPERIMENTAL_BROWSER_MAX_SELECTION_CHARS = 32_000;
export const EXPERIMENTAL_BROWSER_CONTEXT_CHARS = 1_500;
export const EXPERIMENTAL_BROWSER_CAPTURE_CONTEXT_CHARS = 240;
export const EXPERIMENTAL_BROWSER_CAPTURE_MAX_EDGE = 1_200;

export interface ExperimentalBrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExperimentalBrowserSelectionCapture {
  token: string;
  fingerprint: string;
  url: string;
  title: string;
  text: string;
  prefix: string;
  suffix: string;
  cssSelector?: string;
  xpath?: string;
  rects: ExperimentalBrowserRect[];
}

export type ExperimentalBrowserWebviewMessage =
  | { type: 'ready' }
  | { type: 'navigate'; url: string }
  | { type: 'navigateHistory'; direction: 'back' | 'forward' | 'reload' }
  | { type: 'openExternal'; url: string }
  | { type: 'selectionChanged'; selection?: ExperimentalBrowserSelectionCapture }
  | { type: 'copySelectionForAgent'; token: string; fingerprint: string }
  | { type: 'copySelectionLink'; token: string; fingerprint: string }
  | {
      type: 'sendSelection';
      token: string;
      fingerprint: string;
      selectionPngBase64?: string;
      screenshotReason?: string;
    };

export type ExperimentalBrowserHostMessage =
  | { type: 'navigate'; url: string }
  | {
      type: 'loading';
      token: string;
      url: string;
    }
  | {
      type: 'loaded';
      token: string;
      url: string;
      title: string;
      html: string;
      canGoBack: boolean;
      canGoForward: boolean;
      screenshotAvailable: boolean;
      screenshotReason?: string;
    }
  | {
      type: 'loadError';
      token: string;
      url: string;
      message: string;
    }
  | {
      type: 'selectionActionResult';
      action: 'copyForAgent' | 'copyLink';
      ok: boolean;
      message: string;
    }
  | {
      type: 'sendResult';
      ok: boolean;
      message: string;
    };

export function boundedExperimentalCaptureExcerpt(
  value: Pick<ExperimentalBrowserSelectionCapture, 'text' | 'prefix' | 'suffix'>,
): { prefix: string; text: string; suffix: string } {
  return {
    prefix: value.prefix.slice(-EXPERIMENTAL_BROWSER_CAPTURE_CONTEXT_CHARS),
    text: value.text.slice(0, EXPERIMENTAL_BROWSER_MAX_SELECTION_CHARS),
    suffix: value.suffix.slice(0, EXPERIMENTAL_BROWSER_CAPTURE_CONTEXT_CHARS),
  };
}

export function boundedExperimentalCaptureSize(
  width: number,
  height: number,
): { width: number; height: number } {
  return {
    width: Math.min(EXPERIMENTAL_BROWSER_CAPTURE_MAX_EDGE, Math.max(320, Math.ceil(width))),
    height: Math.min(EXPERIMENTAL_BROWSER_CAPTURE_MAX_EDGE, Math.max(80, Math.ceil(height))),
  };
}

export function experimentalBrowserSelectionFingerprintInput(
  value: Omit<ExperimentalBrowserSelectionCapture, 'fingerprint'>,
): string {
  return JSON.stringify({
    token: value.token,
    url: value.url,
    title: value.title,
    text: value.text,
    prefix: value.prefix,
    suffix: value.suffix,
    cssSelector: value.cssSelector ?? null,
    xpath: value.xpath ?? null,
    rects: value.rects,
  });
}
