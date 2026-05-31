export type CopyTextFallback = (text: string) => void;

export async function writeTextToClipboard(text: string, fallback: CopyTextFallback): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // VS Code webviews can expose navigator.clipboard while denying writes.
  }
  fallback(text);
}

export function dispatchCopyTextEvent(target: EventTarget, text: string): void {
  target.dispatchEvent(new CustomEvent('human-learning-copy-text', {
    bubbles: true,
    detail: { text },
  }));
}
