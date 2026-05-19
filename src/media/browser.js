(function () {
  // Acquire the VS Code extension API
  const vscode = acquireVsCodeApi();

  // Application State
  let tabs = [];
  let activeTabId = null;
  let bookmarks = [];
  let history = [];
  let settings = {
    defaultSearchEngine: "duckduckgo",
    homepage: ""
  };
  let sidebarCollapsed = true;
  let activeSidebarTab = "bookmarks";

  // DOM Elements
  const tabsBar = document.getElementById("tabs-bar");
  const btnNewTab = document.getElementById("btn-new-tab");
  const btnBack = document.getElementById("btn-back");
  const btnForward = document.getElementById("btn-forward");
  const btnRefresh = document.getElementById("btn-refresh");
  const btnHome = document.getElementById("btn-home");
  const addressForm = document.getElementById("address-form");
  const addressInput = document.getElementById("address-input");
  const btnBookmark = document.getElementById("btn-bookmark");
  const svgBookmarkOutline = document.getElementById("svg-bookmark-outline");
  const svgBookmarkFilled = document.getElementById("svg-bookmark-filled");
  const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
  const sidebarPanel = document.getElementById("sidebar-panel");
  const btnCloseSidebar = document.getElementById("btn-close-sidebar");
  const tabBtnBookmarks = document.getElementById("tab-btn-bookmarks");
  const tabBtnHistory = document.getElementById("tab-btn-history");
  const sidebarBookmarks = document.getElementById("sidebar-bookmarks");
  const sidebarHistory = document.getElementById("sidebar-history");
  const bookmarksList = document.getElementById("bookmarks-list");
  const bookmarksEmpty = document.getElementById("bookmarks-empty");
  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  const btnClearHistory = document.getElementById("btn-clear-history");
  const viewportContainer = document.getElementById("viewport-container");

  // Initial setup: Ask backend for stored bookmarks and history
  vscode.postMessage({ command: "getInitialState" });

  // Pending fetch requests (requestId -> callback)
  const pendingFetches = {};

  // Handle messages from backend
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
      case "initialState":
        bookmarks = message.bookmarks || [];
        history = message.history || [];
        if (message.settings) {
          settings = message.settings;
        }
        renderBookmarks();
        renderHistory();
        
        // Initialize with a default tab if no tabs are active
        if (tabs.length === 0) {
          const startupUrl = settings.homepage || "browser://home";
          createNewTab(startupUrl);
        }
        break;

      case "fetchUrlResult":
        if (message.requestId && pendingFetches[message.requestId]) {
          pendingFetches[message.requestId](message);
          delete pendingFetches[message.requestId];
        }
        break;
    }
  });

  // Event Listeners for controls
  btnNewTab.addEventListener("click", () => createNewTab("browser://home"));
  btnHome.addEventListener("click", () => navigateActiveTab("browser://home"));
  btnRefresh.addEventListener("click", reloadActiveTab);
  
  // Back/Forward buttons
  btnBack.addEventListener("click", () => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.iframe) {
      // Note: cross-origin standard frames may block reading history length, 
      // but we still attempt history navigation.
      try {
        activeTab.iframe.contentWindow.history.back();
      } catch (e) {
        vscode.postMessage({ 
          command: "showError", 
          text: "Back navigation might be restricted by cross-origin security headers." 
        });
      }
    }
  });

  btnForward.addEventListener("click", () => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.iframe) {
      try {
        activeTab.iframe.contentWindow.history.forward();
      } catch (e) {
        vscode.postMessage({ 
          command: "showError", 
          text: "Forward navigation might be restricted by cross-origin security headers." 
        });
      }
    }
  });

  // Address Bar Submission
  addressForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = addressInput.value.trim();
    if (!query) return;

    const url = resolveUrl(query);
    navigateActiveTab(url);
  });

  // Bookmark active page
  btnBookmark.addEventListener("click", toggleActiveBookmark);

  // Sidebar controls
  btnToggleSidebar.addEventListener("click", toggleSidebar);
  btnCloseSidebar.addEventListener("click", () => {
    sidebarPanel.classList.add("collapsed");
    sidebarCollapsed = true;
  });

  tabBtnBookmarks.addEventListener("click", () => switchSidebarTab("bookmarks"));
  tabBtnHistory.addEventListener("click", () => switchSidebarTab("history"));
  btnClearHistory.addEventListener("click", clearBrowserHistory);

  // Tab Manager Functions

  /**
   * Creates a new browser tab.
   *
   * @param {string} url The URL to load.
   */
  function createNewTab(url) {
    const tabId = "tab-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const resolvedUrl = url || "browser://home";

    // Create the tab element in header
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.id = tabId;
    tabEl.innerHTML = `
      <span class="tab-title">Loading...</span>
      <span class="tab-close" title="Close Tab">
        <svg viewBox="0 0 24 24" width="10" height="10"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>
      </span>
    `;

    // Click handler to switch tab
    tabEl.addEventListener("click", (e) => {
      if (e.target.closest(".tab-close")) {
        closeTab(tabId);
      } else {
        switchTab(tabId);
      }
    });

    // Insert tab right before the "New Tab" button
    tabsBar.insertBefore(tabEl, btnNewTab);

    // Create container viewport for this specific tab
    const viewport = document.createElement("div");
    viewport.className = "browser-viewport-wrapper";
    viewport.id = "viewport-" + tabId;
    viewport.style.width = "100%";
    viewport.style.height = "100%";
    viewport.style.display = "none";
    viewportContainer.appendChild(viewport);

    const newTab = {
      id: tabId,
      url: resolvedUrl,
      title: "New Tab",
      element: tabEl,
      viewport: viewport,
      iframe: null,
      dashboard: null
    };

    tabs.push(newTab);
    switchTab(tabId);
    loadTabContent(newTab, resolvedUrl);
  }

  /**
   * Switches the active viewport and tab focus.
   *
   * @param {string} tabId Target tab ID.
   */
  function switchTab(tabId) {
    if (activeTabId === tabId) return;

    tabs.forEach(t => {
      if (t.id === tabId) {
        t.element.classList.add("active");
        t.viewport.style.display = "block";
        activeTabId = t.id;
        
        // Update URL input and bookmark status
        addressInput.value = t.url === "browser://home" ? "" : t.url;
        updateBookmarkIcon(t.url);
      } else {
        t.element.classList.remove("active");
        t.viewport.style.display = "none";
      }
    });
  }

  /**
   * Closes a tab and disposes associated DOM components.
   *
   * @param {string} tabId Tab ID to close.
   */
  function closeTab(tabId) {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const closingTab = tabs[index];
    closingTab.element.remove();
    closingTab.viewport.remove();

    tabs.splice(index, 1);

    // If active tab was closed, focus another one
    if (activeTabId === tabId) {
      if (tabs.length > 0) {
        const nextActiveIndex = Math.min(index, tabs.length - 1);
        switchTab(tabs[nextActiveIndex].id);
      } else {
        createNewTab("browser://home");
      }
    }
  }

  /**
   * Gets the active tab state object.
   *
   * @returns {object|null} The active tab.
   */
  function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
  }

  /**
   * Navigates the currently active tab.
   *
   * @param {string} url Destination URL.
   */
  function navigateActiveTab(url) {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    activeTab.url = url;
    addressInput.value = url === "browser://home" ? "" : url;
    loadTabContent(activeTab, url);
    updateBookmarkIcon(url);

    // Add to history
    if (url && url !== "browser://home") {
      addToHistory(url);
    }
  }

  /**
   * Reloads the active tab by re-fetching the current URL.
   */
  function reloadActiveTab() {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.url) {
      loadTabContent(activeTab, activeTab.url);
    }
  }

  /**
   * Generates a unique request ID for async fetch correlation.
   *
   * @returns {string} Unique request identifier.
   */
  function generateRequestId() {
    return "req_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Loads content inside a tab.
   * For browser://home, renders dashboard directly.
   * For http/https URLs, fetches via extension host (Node.js, zero CORS) and displays via blob URL.
   *
   * @param {object} tab Tab object.
   * @param {string} url URL to load.
   */
  function loadTabContent(tab, url) {
    // Clean previous viewport children and revoke old blob URL
    if (tab.blobUrl) {
      URL.revokeObjectURL(tab.blobUrl);
      tab.blobUrl = null;
    }
    tab.viewport.innerHTML = "";
    tab.iframe = null;
    tab.dashboard = null;

    if (url === "browser://home") {
      tab.title = "Home Dashboard";
      tab.element.querySelector(".tab-title").textContent = tab.title;

      const dashboard = document.createElement("div");
      dashboard.className = "dashboard-container";
      dashboard.innerHTML = `
        <div class="dashboard-hero">
          <div class="dashboard-logo">VSCode Browser</div>
          <div class="dashboard-tagline">Access the web seamlessly inside your workspace</div>
        </div>

        <div class="dashboard-section">
          <div class="section-title">Quick Connect (Localhost)</div>
          <div class="quick-connect-grid">
            <button class="connect-btn" data-port="3000">
              <span class="connect-label">Port 3000</span>
              <span class="connect-sub">React / Node</span>
            </button>
            <button class="connect-btn" data-port="5173">
              <span class="connect-label">Port 5173</span>
              <span class="connect-sub">Vite Preview</span>
            </button>
            <button class="connect-btn" data-port="8080">
              <span class="connect-label">Port 8080</span>
              <span class="connect-sub">Webpack / Java</span>
            </button>
            <button class="connect-btn" data-port="8000">
              <span class="connect-label">Port 8000</span>
              <span class="connect-sub">Django / PHP</span>
            </button>
          </div>
        </div>
      `;

      dashboard.querySelectorAll(".connect-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const port = btn.getAttribute("data-port");
          navigateActiveTab(`http://localhost:${port}`);
        });
      });

      tab.viewport.appendChild(dashboard);
      tab.dashboard = dashboard;
    } else {
      // Show loading state
      tab.title = extractHost(url);
      tab.element.querySelector(".tab-title").textContent = tab.title;

      const mainFrameContainer = document.createElement("div");
      mainFrameContainer.style.display = "flex";
      mainFrameContainer.style.flexDirection = "column";
      mainFrameContainer.style.width = "100%";
      mainFrameContainer.style.height = "100%";

      const helperBar = document.createElement("div");
      helperBar.style.display = "flex";
      helperBar.style.alignItems = "center";
      helperBar.style.justifyContent = "space-between";
      helperBar.style.padding = "4px 12px";
      helperBar.style.backgroundColor = "var(--vscode-sideBar-background, #252526)";
      helperBar.style.borderBottom = "1px solid var(--vscode-panel-border, #3c3c3c)";
      helperBar.style.fontSize = "11px";
      helperBar.style.color = "var(--vscode-descriptionForeground, #808080)";
      
      helperBar.innerHTML = `
        <span>Loading: <strong>${url}</strong></span>
        <button class="secondary-btn" id="btn-open-external-top" style="padding: 2px 8px; font-size: 10px;">
          Open in External Browser
        </button>
      `;

      helperBar.querySelector("#btn-open-external-top").addEventListener("click", () => {
        vscode.postMessage({ command: "openExternal", url: url });
      });

      // Create the iframe container (content will be loaded via blob URL)
      const iframe = document.createElement("iframe");
      iframe.className = "browser-iframe active";
      iframe.style.flex = "1";
      iframe.style.border = "none";
      iframe.style.width = "100%";
      iframe.style.height = "100%";

      mainFrameContainer.appendChild(helperBar);
      mainFrameContainer.appendChild(iframe);
      tab.viewport.appendChild(mainFrameContainer);
      tab.iframe = iframe;

      // Request the extension host to fetch this URL using Node.js (zero CORS)
      const requestId = generateRequestId();
      pendingFetches[requestId] = (result) => {
        if (result.success) {
          // Create blob URL from the fetched HTML and load into iframe
          const blob = new Blob([result.html], { type: "text/html; charset=utf-8" });
          const blobUrl = URL.createObjectURL(blob);
          tab.blobUrl = blobUrl;
          iframe.src = blobUrl;

          // Update helper bar text
          const helperSpan = helperBar.querySelector("span");
          if (helperSpan) {
            helperSpan.innerHTML = `Previewing: <strong>${url}</strong>`;
          }

          tab.title = extractHost(url);
          tab.element.querySelector(".tab-title").textContent = tab.title;
        } else {
          // Show error in iframe
          const errorHtml = `<!DOCTYPE html>
<html><head><style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1e1e1e; color: #ccc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.c { text-align: center; max-width: 480px; padding: 32px; }
h1 { color: #fff; font-size: 18px; margin-bottom: 12px; }
p { font-size: 13px; line-height: 1.6; color: #808080; }
code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
</style></head><body>
<div class="c"><h1>Connection Failed</h1><p>Could not load <code>${url}</code></p><p>${result.error || "Unknown error"}</p></div>
</body></html>`;
          const blob = new Blob([errorHtml], { type: "text/html" });
          const blobUrl = URL.createObjectURL(blob);
          tab.blobUrl = blobUrl;
          iframe.src = blobUrl;
        }
      };

      vscode.postMessage({ command: "fetchUrl", url: url, requestId: requestId });
    }
  }

  // URL Helper / Resolver

  /**
   * Resolves a string query into a formal HTTP URL.
   *
   * @param {string} input Query input string.
   * @returns {string} Fully qualified URL or search query.
   */
  function resolveUrl(input) {
    const trimmed = input.trim();

    // Check if it looks like a local IP / port
    const localPortMatch = trimmed.match(/^localhost:([0-9]+)$/i);
    if (localPortMatch) {
      return `http://localhost:${localPortMatch[1]}`;
    }

    // Check if it's already an absolute URL
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    // Check if it looks like a general domain name
    if (/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/i.test(trimmed)) {
      return `http://${trimmed}`;
    }

    // Search query fallback (using Google exclusively)
    return "https://www.google.com/search?q=" + encodeURIComponent(trimmed);
  }

  /**
   * Extracts hostname from a full URL.
   *
   * @param {string} url Source URL.
   * @returns {string} Hostname or clean name.
   */
  function extractHost(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (e) {
      return url;
    }
  }

  // Bookmarks Logic

  /**
   * Renders the bookmarks list inside sidebar.
   */
  function renderBookmarks() {
    bookmarksList.innerHTML = "";
    if (bookmarks.length === 0) {
      bookmarksEmpty.style.display = "flex";
      return;
    }
    bookmarksEmpty.style.display = "none";

    bookmarks.forEach((b, idx) => {
      const li = document.createElement("li");
      li.className = "sidebar-item";
      li.innerHTML = `
        <div class="item-info">
          <span class="item-title">${b.title || extractHost(b.url)}</span>
          <span class="item-url">${b.url}</span>
        </div>
        <span class="item-remove icon-btn" title="Remove Bookmark">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>
        </span>
      `;

      li.querySelector(".item-info").addEventListener("click", () => {
        navigateActiveTab(b.url);
      });

      li.querySelector(".item-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeBookmark(idx);
      });

      bookmarksList.appendChild(li);
    });
  }

  /**
   * Toggles the bookmark state of the active tab URL.
   */
  function toggleActiveBookmark() {
    const activeTab = getActiveTab();
    if (!activeTab || activeTab.url === "browser://home") return;

    const existingIdx = bookmarks.findIndex(b => b.url === activeTab.url);
    if (existingIdx !== -1) {
      // Remove bookmark
      bookmarks.splice(existingIdx, 1);
    } else {
      // Add bookmark
      bookmarks.push({
        title: activeTab.title,
        url: activeTab.url
      });
    }

    renderBookmarks();
    updateBookmarkIcon(activeTab.url);
    vscode.postMessage({ command: "saveBookmarks", bookmarks });
  }

  /**
   * Removes bookmark by index.
   *
   * @param {number} idx Bookmark index.
   */
  function removeBookmark(idx) {
    bookmarks.splice(idx, 1);
    renderBookmarks();
    const activeTab = getActiveTab();
    if (activeTab) {
      updateBookmarkIcon(activeTab.url);
    }
    vscode.postMessage({ command: "saveBookmarks", bookmarks });
  }

  /**
   * Updates bookmark navbar icon based on URL status.
   *
   * @param {string} url Target URL.
   */
  function updateBookmarkIcon(url) {
    if (url === "browser://home") {
      btnBookmark.style.opacity = "0.3";
      svgBookmarkOutline.style.display = "block";
      svgBookmarkFilled.style.display = "none";
      return;
    }
    btnBookmark.style.opacity = "1";

    const isBookmarked = bookmarks.some(b => b.url === url);
    if (isBookmarked) {
      svgBookmarkOutline.style.display = "none";
      svgBookmarkFilled.style.display = "block";
    } else {
      svgBookmarkOutline.style.display = "block";
      svgBookmarkFilled.style.display = "none";
    }
  }

  // History Logic

  /**
   * Appends URL record to user navigation history list.
   *
   * @param {string} url Navigated URL.
   */
  function addToHistory(url) {
    const activeTab = getActiveTab();
    const historyItem = {
      title: activeTab ? activeTab.title : extractHost(url),
      url: url,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Filter duplicates occurring consecutively
    if (history.length > 0 && history[0].url === url) {
      return;
    }

    history.unshift(historyItem);
    // Cap history length
    if (history.length > 100) {
      history.pop();
    }

    renderHistory();
    vscode.postMessage({ command: "saveHistory", history });
  }

  /**
   * Renders the browsing history list.
   */
  function renderHistory() {
    historyList.innerHTML = "";
    if (history.length === 0) {
      historyEmpty.style.display = "flex";
      return;
    }
    historyEmpty.style.display = "none";

    history.forEach(h => {
      const li = document.createElement("li");
      li.className = "sidebar-item";
      li.innerHTML = `
        <div class="item-info">
          <span class="item-title">${h.title || extractHost(h.url)}</span>
          <span class="item-url">${h.url} - <small>${h.timestamp}</small></span>
        </div>
      `;

      li.addEventListener("click", () => {
        navigateActiveTab(h.url);
      });

      historyList.appendChild(li);
    });
  }

  /**
   * Clears the entire accumulated browsing history records.
   */
  function clearBrowserHistory() {
    history = [];
    renderHistory();
    vscode.postMessage({ command: "saveHistory", history });
  }

  // Sidebar Layout Switcher

  /**
   * Toggles the open/close state of sidebar.
   */
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    if (sidebarCollapsed) {
      sidebarPanel.classList.add("collapsed");
    } else {
      sidebarPanel.classList.remove("collapsed");
    }
  }

  /**
   * Toggles the selected tab within sidebar panel (Bookmarks vs History).
   *
   * @param {string} tabName Selected tab name.
   */
  function switchSidebarTab(tabName) {
    activeSidebarTab = tabName;
    if (tabName === "bookmarks") {
      tabBtnBookmarks.classList.add("active");
      tabBtnHistory.classList.remove("active");
      sidebarBookmarks.classList.add("active");
      sidebarHistory.classList.remove("active");
    } else {
      tabBtnBookmarks.classList.remove("active");
      tabBtnHistory.classList.add("active");
      sidebarBookmarks.classList.remove("active");
      sidebarHistory.classList.add("active");
    }
  }

})();
