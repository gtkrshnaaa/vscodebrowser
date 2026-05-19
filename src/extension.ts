import * as vscode from "vscode";
import { BrowserPanel } from "./browserPanel";

/**
 * Activates the VSCode Browser extension.
 * Registers the commands and initializes the extension host logic.
 *
 * @param context The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log("VSCode Browser extension is now active.");

  // Register command to open the browser panel
  const openCommand = vscode.commands.registerCommand("vscodebrowser.open", async () => {
    await BrowserPanel.createOrShow(context);
  });

  context.subscriptions.push(openCommand);
}

/**
 * Deactivates the VSCode Browser extension.
 * Cleans up the proxy server and allocated resources.
 */
export function deactivate(): void {
  if (BrowserPanel.proxyServer) {
    BrowserPanel.proxyServer.stop();
    BrowserPanel.proxyServer = undefined;
  }
}
