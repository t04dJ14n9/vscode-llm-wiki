// Minimal VS Code webview bridge surface required by the shared PDF entry.
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
