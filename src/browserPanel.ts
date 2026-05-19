import * as vscode from "vscode";
import { PageFetcher } from "./proxyServer";

/**
 * Manages the lifecycle and UI state of the VSCode Browser Webview Panel.
 */
export class BrowserPanel {
  public static currentPanel: BrowserPanel | undefined;

  private static readonly viewType = "vscodebrowser";
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Creates or shows the existing browser panel.
   *
   * @param context The extension context.
   */
  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (BrowserPanel.currentPanel) {
      BrowserPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      BrowserPanel.viewType,
      "VSCode Browser",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "src", "media"),
          vscode.Uri.joinPath(context.extensionUri, "dist")
        ]
      }
    );

    BrowserPanel.currentPanel = new BrowserPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._extensionUri = context.extensionUri;
    this._context = context;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "getInitialState":
            this._sendInitialState();
            break;
          case "saveBookmarks":
            await this._context.globalState.update("vscodebrowser.bookmarks", message.bookmarks);
            break;
          case "saveHistory":
            await this._context.globalState.update("vscodebrowser.history", message.history);
            break;
          case "openExternal":
            if (message.url) {
              try {
                await vscode.env.openExternal(vscode.Uri.parse(message.url));
              } catch (error) {
                vscode.window.showErrorMessage(`Failed to open URL externally: ${message.url}`);
              }
            }
            break;
          case "fetchUrl":
            await this._handleFetchUrl(message.url, message.requestId);
            break;
          case "showError":
            vscode.window.showErrorMessage(message.text || "An error occurred");
            break;
        }
      },
      null,
      this._disposables
    );
  }

  /**
   * Fetches a URL using Node.js (bypassing all CORS/iframe restrictions)
   * and sends the HTML content back to the webview via postMessage.
   *
   * @param url The target URL to fetch.
   * @param requestId Unique ID to correlate request/response in the webview.
   */
  private async _handleFetchUrl(url: string, requestId: string): Promise<void> {
    try {
      const result = await PageFetcher.fetch(url);
      this._panel.webview.postMessage({
        command: "fetchUrlResult",
        requestId,
        success: true,
        html: result.html,
        finalUrl: result.finalUrl
      });
    } catch (err: any) {
      this._panel.webview.postMessage({
        command: "fetchUrlResult",
        requestId,
        success: false,
        error: err.message || "Unknown error",
        url
      });
    }
  }

  private _sendInitialState(): void {
    const bookmarks = this._context.globalState.get<any[]>("vscodebrowser.bookmarks") || [];
    const history = this._context.globalState.get<any[]>("vscodebrowser.history") || [];
    
    const config = vscode.workspace.getConfiguration("vscodebrowser");
    const defaultSearchEngine = config.get<string>("defaultSearchEngine") || "google";
    const homepage = config.get<string>("homepage") || "";

    this._panel.webview.postMessage({
      command: "initialState",
      bookmarks,
      history,
      settings: {
        defaultSearchEngine,
        homepage
      }
    });
  }

  public dispose(): void {
    BrowserPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update(): void {
    const webview = this._panel.webview;
    this._panel.title = "VSCode Browser";
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "src", "media", "browser.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "src", "media", "browser.css")
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: http: data:; font-src ${webview.cspSource} https:; connect-src * http: https: ws: wss:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>VSCode Browser</title>
</head>
<body>
  <div id="app-container">
    <header class="browser-header">
      <div class="tabs-container" id="tabs-bar">
        <button id="btn-new-tab" class="icon-btn tab-action-btn" title="Open New Tab">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/></svg>
        </button>
      </div>

      <div class="toolbar">
        <div class="nav-controls">
          <button id="btn-back" class="icon-btn nav-btn" title="Back">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor"/></svg>
          </button>
          <button id="btn-forward" class="icon-btn nav-btn" title="Forward">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" fill="currentColor"/></svg>
          </button>
          <button id="btn-refresh" class="icon-btn nav-btn" title="Reload">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/></svg>
          </button>
          <button id="btn-home" class="icon-btn nav-btn" title="Home Dashboard">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" fill="currentColor"/></svg>
          </button>
        </div>

        <form class="address-bar-container" id="address-form">
          <input type="text" id="address-input" autocomplete="off" placeholder="Enter URL or search..." />
          <button type="submit" style="display:none;"></button>
        </form>

        <div class="action-controls">
          <button id="btn-bookmark" class="icon-btn nav-btn" title="Bookmark Page">
            <svg id="svg-bookmark-outline" viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="currentColor"/></svg>
            <svg id="svg-bookmark-filled" viewBox="0 0 24 24" width="16" height="16" style="display:none;"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="currentColor"/></svg>
          </button>
          <button id="btn-toggle-sidebar" class="icon-btn nav-btn" title="Toggle Bookmarks & History">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-2h5v-2h-5v2zm0-4h5v-2h-5v2zm0-4h5V7h-5v2zM7 7h3v10H7V7z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="main-layout">
      <main class="webview-viewport" id="viewport-container">
      </main>

      <aside class="sidebar collapsed" id="sidebar-panel">
        <div class="sidebar-header">
          <div class="sidebar-tabs">
            <button id="tab-btn-bookmarks" class="sidebar-tab-btn active">Bookmarks</button>
            <button id="tab-btn-history" class="sidebar-tab-btn">History</button>
          </div>
          <button id="btn-close-sidebar" class="icon-btn" title="Close Panel">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>
          </button>
        </div>

        <div class="sidebar-content active" id="sidebar-bookmarks">
          <ul class="sidebar-list" id="bookmarks-list"></ul>
          <div id="bookmarks-empty" class="empty-state">
            No bookmarks saved yet. Click the ribbon icon to add one!
          </div>
        </div>

        <div class="sidebar-content" id="sidebar-history">
          <div class="sidebar-actions">
            <button id="btn-clear-history" class="text-btn">Clear History</button>
          </div>
          <ul class="sidebar-list" id="history-list"></ul>
          <div id="history-empty" class="empty-state">
            No browsing history recorded.
          </div>
        </div>
      </aside>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Generates a random cryptographic nonce.
 */
function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
