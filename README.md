# VSCode Browser Extension

A premium, high-fidelity, and feature-rich multi-tabbed web browser integrated directly inside Visual Studio Code.

---

## Key Features

1. Multi-Tabbed Browsing
   Allows users to open multiple independent browsing tabs inside a single editor window. Tabs are managed dynamically using hidden iframe containers to fully preserve their active state, input fields, or navigation history when switching back and forth.

2. Interactive Dashboard Homepage
   A customized startup dashboard is rendered when launching a new tab. It includes quick-connect buttons for common local web development ports (3000, 5173, 8080, 8000) and a default search engine picker (DuckDuckGo, Google, Bing).

3. Advanced Navigation and Tool Bar
   Equipped with Back, Forward, Reload, and Home navigation keys. The address bar dynamically parses input to detect domain structures, localhost addresses, and falls back to search engine queries for standard text search. It also provides an external browser redirection helper.

4. Persistent Bookmarks and History
   Features a toggleable sidebar panel containing reactive bookmarks and browsing history lists. Custom data is persisted securely via the VS Code Extension globalState API across editor sessions.

5. Native VS Code Theme Syncing
   Built using modern Vanilla CSS with CSS variable bindings matching VS Code's active editor environment. The UI transitions in real-time to dark, light, or high-contrast themes.

---

## Directory Structure

* scripts/
  * build-vsix.sh - Packaging shell script.
* src/
  * extension.ts - Extension activation and entry point.
  * browserPanel.ts - Extension host panel manager, state router, and layout injector.
  * media/
    * browser.css - Premium glassmorphism stylesheet.
    * browser.js - Client tab coordinator, dashboard renderer, history and bookmark manager.
* dist/
  * extension.js - Production compiled bundle.
* package.json - Extension manifest.
* tsconfig.json - TypeScript compiler configuration.
* esbuild.js - esbuild build parameters.
* .vscodeignore - Packaging filters.
* LICENSE - MIT License terms.

---

## Development and Running

To run and debug the extension locally:

1. Open this project directory in Visual Studio Code.
2. Press F5 (or navigate to Run -> Start Debugging) to launch a new VS Code Extension Development Host window.
3. In the new host window, open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and execute:
   VSCode Browser: Open Browser
4. Experience the multi-tabbed dashboard, bookmark pages, and connect to local web development servers.

---

## Packaging the Extension (VSIX)

We have provided a fully non-interactive packaging shell script to build an installable .vsix package:

```bash
./scripts/build-vsix.sh
```

Executing this script will automatically:
1. Load the local Node.js environment paths.
2. Install necessary node modules.
3. Compile the production-ready code bundles using esbuild.
4. Filter unnecessary development scripts and source code using the .vscodeignore profile.
5. Compile and export the optimized installer straight to the release folder:
   release/vscodebrowser-0.1.0.vsix

The resulting VSIX file can be shared, distributed, and installed manually in any standard Visual Studio Code instance.
