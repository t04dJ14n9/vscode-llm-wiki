import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __mockMessages: Array<Record<string, unknown>>;
  }
}

async function bootstrapBrowser(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('http://localhost:8979/web-browser.html');
  await page.waitForFunction(() => window.__mockMessages.some(message => message.type === 'ready'));
  await page.evaluate(() => {
    window.postMessage({
      type: 'loading',
      token: 'page-token',
      url: 'https://example.com/guide',
    }, '*');
    window.postMessage({
      type: 'loaded',
      token: 'page-token',
      url: 'https://example.com/guide',
      title: 'Example guide',
      html: `<!doctype html><html><head><title>Example guide</title></head><body>
        <script>window.remoteScriptExecuted = true;<\/script>
        <main><article>
          <p id="before">Context before the important passage.</p>
          <p id="passage">The selected browser passage is exact and source grounded.</p>
          <form><input value="secret"><button>Submit</button></form>
          <img src="https://example.com/remote.png" alt="remote">
          <a href="/next">Next page</a>
          <p id="after">Context after the important passage.</p>
        </article></main>
      </body></html>`,
      canGoBack: true,
      canGoForward: false,
      screenshotAvailable: true,
    }, '*');
  });
  await expect(page.getByText(
    'The selected browser passage is exact and source grounded.',
    { exact: true },
  )).toBeVisible();
}

test.describe('LLM Wiki safe web browser', () => {
  test('sanitizes public HTML and exposes navigation controls', async ({ page }) => {
    await bootstrapBrowser(page);

    await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Forward' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeEnabled();
    await expect(page.locator('.reader-content script')).toHaveCount(0);
    await expect(page.locator('.reader-content form')).toHaveCount(0);
    await expect(page.locator('.reader-content img')).toHaveCount(0);
    await expect(page.locator('.reader-content a')).toHaveAttribute(
      'href',
      'https://example.com/next',
    );
    await expect(page.evaluate(() => Boolean((window as unknown as { remoteScriptExecuted?: boolean }).remoteScriptExecuted))).resolves.toBe(false);

    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Reload' }).click();
    await page.getByRole('button', { name: 'Open live' }).click();
    const types = await page.evaluate(() => window.__mockMessages.slice(-3));
    expect(types).toEqual([
      { type: 'navigateHistory', direction: 'back' },
      { type: 'navigateHistory', direction: 'reload' },
      { type: 'openExternal', url: 'https://example.com/guide' },
    ]);
  });

  test('captures one passage for copy, source-link, and agent handoff', async ({ page }) => {
    await bootstrapBrowser(page);
    await page.evaluate(() => {
      const passage = Array.from(document.querySelectorAll('.reader-content p')).find(
        element => element.textContent === 'The selected browser passage is exact and source grounded.',
      );
      if (!passage) throw new Error('Missing passage');
      const range = document.createRange();
      range.selectNodeContents(passage);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      passage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__mockMessages.some(
      message => message.type === 'selectionChanged' && message.selection,
    ));

    await expect(page.getByRole('button', { name: 'Copy source link' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Copy for Agent' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Add to Agent' })).toBeEnabled();
    await page.getByRole('button', { name: 'Copy source link' }).click();
    await page.getByRole('button', { name: 'Copy for Agent' }).click();
    await page.getByRole('button', { name: 'Add to Agent' }).click();

    await page.waitForFunction(() => window.__mockMessages.some(
      message => message.type === 'sendSelection',
    ));
    const actions = await page.evaluate(() => window.__mockMessages.filter(message => [
      'copySelectionLink',
      'copySelectionForAgent',
      'sendSelection',
    ].includes(String(message.type))));
    expect(actions.map(message => message.type)).toEqual([
      'copySelectionLink',
      'copySelectionForAgent',
      'sendSelection',
    ]);
    for (const action of actions) {
      expect(action.token).toBe('page-token');
      expect(typeof action.fingerprint).toBe('string');
      expect(String(action.fingerprint).length).toBe(64);
    }
    const selected = await page.evaluate(() => window.__mockMessages.find(
      message => message.type === 'selectionChanged' && message.selection,
    )?.selection as { text?: string; prefix?: string; suffix?: string });
    expect(selected.text).toBe('The selected browser passage is exact and source grounded.');
    expect(selected.prefix).toContain('Context before the important passage.');
    expect(selected.suffix).toContain('Context after the important passage.');
  });
});
