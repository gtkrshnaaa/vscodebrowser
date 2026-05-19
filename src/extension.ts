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

  const openCommand = vscode.commands.registerCommand("vscodebrowser.open", () => {
    BrowserPanel.createOrShow(context);
  });

  context.subscriptions.push(openCommand);
}

/**
 * Deactivates the VSCode Browser extension.
 */
export function deactivate(): void {
  // No background services to clean up
}
