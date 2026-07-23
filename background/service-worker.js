// Service Worker for Safari Window Naming & Switcher Extension
const api = typeof browser !== 'undefined' ? browser : chrome;

// Fetch authoritative live tabs for a specific window directly from Safari tab engine
async function getWindowTabs(windowId) {
  try {
    const tabs = await api.tabs.query({ windowId: windowId });
    return tabs || [];
  } catch (e) {
    return [];
  }
}

// Compute a robust Multi-Tier URL & Title fingerprint for a window using unpinned live tabs
function getWindowFingerprint(win, tabs) {
  if (!tabs || tabs.length === 0) return null;
  
  // Exclude pinned tabs for clean per-window fingerprinting
  const unpinnedTabs = tabs.filter(t => !t.pinned);
  const targetTabs = unpinnedTabs.length > 0 ? unpinnedTabs : tabs;

  const domains = [];
  const urlPaths = [];

  for (const t of targetTabs) {
    try {
      if (!t.url || t.url.startsWith('chrome') || t.url.startsWith('about:')) continue;
      const u = new URL(t.url);
      const domain = u.hostname.replace(/^www\./, '').toLowerCase();
      const cleanPath = (domain + u.pathname).replace(/\/$/, '').toLowerCase();
      
      domains.push(domain);
      urlPaths.push(cleanPath);
    } catch(e) {}
  }

  const titles = targetTabs.map(t => (t.title || '').toLowerCase().trim()).filter(Boolean);
  
  const activeTab = tabs.find(t => t.active) || targetTabs[0];
  let activeDomain = '';
  let activeCleanPath = '';
  let activeTitle = (activeTab && activeTab.title ? activeTab.title : '').toLowerCase().trim();

  try {
    if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome') && !activeTab.url.startsWith('about:')) {
      const u = new URL(activeTab.url);
      activeDomain = u.hostname.replace(/^www\./, '').toLowerCase();
      activeCleanPath = (activeDomain + u.pathname).replace(/\/$/, '').toLowerCase();
    }
  } catch(e) {}

  return {
    count: targetTabs.length,
    domains: domains,
    urlPaths: urlPaths,
    titles: titles,
    activeDomain: activeDomain,
    activeCleanPath: activeCleanPath,
    activeTitle: activeTitle
  };
}

// Fingerprint similarity scoring engine with 1-Tab Disambiguation Rule
function calculateFingerprintSimilarity(liveFp, savedFp) {
  if (!liveFp || !savedFp) return 0;

  const countDiff = Math.abs(liveFp.count - savedFp.count);
  if (countDiff > 2) return 0; // Immediate rejection if tab count differs by > 2

  let score = 0;

  // Exact or close tab count match (Capped at 20 pts for 1-tab windows to prevent blind matching)
  if (countDiff === 0) {
    score += (liveFp.count === 1 ? 20 : 40);
  } else if (countDiff === 1) {
    score += 15;
  }

  // Exact Clean Path Match (Weight - 40 Points)
  if (liveFp.urlPaths && liveFp.urlPaths.length > 0 && savedFp.urlPaths && savedFp.urlPaths.length > 0) {
    let pathMatches = 0;
    const savedPathSet = new Set(savedFp.urlPaths);
    for (const p of liveFp.urlPaths) {
      if (savedPathSet.has(p)) pathMatches++;
    }
    const pathRatio = pathMatches / Math.max(liveFp.urlPaths.length, savedFp.urlPaths.length);
    score += Math.round(pathRatio * 40);
  }

  // Main Domain Overlap Ratio (Weight - 25 Points)
  if (liveFp.domains && liveFp.domains.length > 0 && savedFp.domains && savedFp.domains.length > 0) {
    let domainMatches = 0;
    const savedDomainSet = new Set(savedFp.domains);
    for (const d of liveFp.domains) {
      if (savedDomainSet.has(d)) domainMatches++;
    }
    const domainRatio = domainMatches / Math.max(liveFp.domains.length, savedFp.domains.length);
    score += Math.round(domainRatio * 25);
  }

  // Title Overlap Ratio (Weight - 20 Points)
  if (liveFp.titles && liveFp.titles.length > 0 && savedFp.titles && savedFp.titles.length > 0) {
    let titleMatches = 0;
    for (const t of liveFp.titles) {
      if (savedFp.titles.some(st => st.includes(t) || t.includes(st))) titleMatches++;
    }
    const titleRatio = titleMatches / Math.max(liveFp.titles.length, savedFp.titles.length);
    score += Math.round(titleRatio * 20);
  }

  // Active Path / Domain Match (Weight - 15 Points)
  if (liveFp.activeCleanPath && savedFp.activeCleanPath && liveFp.activeCleanPath === savedFp.activeCleanPath) {
    score += 15;
  } else if (liveFp.activeDomain && savedFp.activeDomain && liveFp.activeDomain === savedFp.activeDomain) {
    score += 10;
  }

  // STRICT 1-TAB DISAMBIGUATION RULE:
  // For 1-tab windows, if no domain, path, or title keywords matched, reject match!
  if (liveFp.count === 1) {
    const hasIdentityMatch = (
      (liveFp.activeCleanPath && savedFp.activeCleanPath && liveFp.activeCleanPath === savedFp.activeCleanPath) ||
      (liveFp.activeDomain && savedFp.activeDomain && liveFp.activeDomain === savedFp.activeDomain) ||
      (liveFp.titles.length > 0 && savedFp.titles.length > 0 && liveFp.titles.some(t => savedFp.titles.some(st => st.includes(t) || t.includes(st))))
    );

    if (!hasIdentityMatch) {
      return 0; // REJECT BLIND 1-TAB MATCH!
    }
  }

  return score;
}

// Global flag to restrict registry restoration matching strictly to cold startup
let isRestoringSession = true;
setTimeout(() => {
  isRestoringSession = false;
}, 10000); // 10-second lock on cold startup

// Purge 1-char or 2-char placeholder test names (like 'a', 'b', 'c', 'd', 'g', 'k', 'q', 't')
async function purgeSingleLetterTestNames() {
  try {
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    let modified = false;

    const cleanedWindowNames = {};
    for (const [winId, name] of Object.entries(windowNames)) {
      if (name) {
        const trimmed = name.trim();
        if (trimmed.length <= 2 && /^[a-z0-9]{1,2}$/i.test(trimmed)) {
          modified = true;
        } else {
          cleanedWindowNames[winId] = name;
        }
      }
    }

    const cleanedRegistry = savedWindowRegistry.filter(entry => {
      if (!entry || !entry.name) return false;
      const trimmed = entry.name.trim();
      if (trimmed.length <= 2 && /^[a-z0-9]{1,2}$/i.test(trimmed)) {
        modified = true;
        return false;
      }
      return true;
    });

    if (modified) {
      await api.storage.local.set({
        windowNames: cleanedWindowNames,
        savedWindowRegistry: cleanedRegistry
      });
    }
  } catch (e) {}
}

// Run single-letter test name purge on service worker launch
purgeSingleLetterTestNames();

// Initialize default storage & purge ghost test names
api.runtime.onInstalled.addListener(async () => {
  const data = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
  if (!data.windowNames) await api.storage.local.set({ windowNames: {} });
  if (!data.savedWindowRegistry) await api.storage.local.set({ savedWindowRegistry: [] });
  await purgeSingleLetterTestNames();
  await updateAllWindowTooltips();
});

// Sync active window sessions to persistent master registry
async function syncWindowRegistry() {
  try {
    await purgeSingleLetterTestNames();
    const windows = await api.windows.getAll();
    const { windowNames = {} } = await api.storage.local.get('windowNames');
    
    // Parallel Tab Fetching for Maximum Speed
    const validWindows = windows.filter(w => w.type !== 'popup');
    const windowsWithTabs = await Promise.all(validWindows.map(async win => {
      const tabs = await getWindowTabs(win.id);
      return { win, tabs };
    }));

    const updatedRegistry = [];
    const usedNamesLower = new Set();

    // Synchronous Sequential Registry Assembly
    for (const { win, tabs } of windowsWithTabs) {
      const name = windowNames[win.id];
      if (name) {
        const lower = name.trim().toLowerCase();
        if (!usedNamesLower.has(lower)) {
          usedNamesLower.add(lower);
          const fp = getWindowFingerprint(win, tabs);
          if (fp) {
            updatedRegistry.push({
              name: name,
              count: fp.count,
              domains: fp.domains,
              urlPaths: fp.urlPaths,
              titles: fp.titles,
              activeDomain: fp.activeDomain,
              activeCleanPath: fp.activeCleanPath,
              activeTitle: fp.activeTitle
            });
          }
        }
      }
    }

    await api.storage.local.set({ savedWindowRegistry: updatedRegistry });
  } catch (e) {}
}

api.tabs.onCreated.addListener((tab) => { if (tab.windowId) syncWindowRegistry(); });
api.tabs.onRemoved.addListener((tabId, removeInfo) => { if (removeInfo.windowId) syncWindowRegistry(); });
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (tab.windowId) syncWindowRegistry(); });

// Best-match algorithm using Fingerprint Similarity Engine (Synchronous In-Memory Execution)
function findBestMatchingCustomName(win, tabs, savedWindowRegistry, usedNamesLower, winIndex) {
  if (!win || !savedWindowRegistry || savedWindowRegistry.length === 0) return null;

  const liveFp = getWindowFingerprint(win, tabs);
  if (!liveFp) return null;

  let bestMatch = null;
  let highestScore = -1;

  // Pass 1: Multi-Tier Fingerprint Similarity Engine Match
  for (let i = 0; i < savedWindowRegistry.length; i++) {
    const saved = savedWindowRegistry[i];
    if (!saved || !saved.name) continue;
    const lowerName = saved.name.trim().toLowerCase();
    if (usedNamesLower.has(lowerName)) continue;

    const score = calculateFingerprintSimilarity(liveFp, saved);

    if (score > highestScore && score >= 35) {
      highestScore = score;
      bestMatch = saved.name;
    }
  }

  // Pass 2: Positional Z-Order Match (ONLY allowed if tab counts match EXACTLY on startup and liveFp.count > 1)
  if (!bestMatch && isRestoringSession && typeof winIndex === 'number' && savedWindowRegistry[winIndex] && liveFp.count > 1) {
    const savedAtPos = savedWindowRegistry[winIndex];
    if (savedAtPos && savedAtPos.name && savedAtPos.count === liveFp.count) {
      const lowerName = savedAtPos.name.trim().toLowerCase();
      if (!usedNamesLower.has(lowerName)) {
        bestMatch = savedAtPos.name;
      }
    }
  }

  return bestMatch;
}

// Window creation listener (Prompt & immediate list update)
api.windows.onCreated.addListener(async (win) => {
  if (!win || win.id === api.windows.WINDOW_ID_NONE || win.type === 'popup') return;

  try {
    const fullWin = await api.windows.get(win.id);
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    
    let name = windowNames[win.id];

    if (!name && isRestoringSession) {
      const allWins = await api.windows.getAll();
      const winIndex = allWins.findIndex(w => w.id === win.id);
      const tabs = await getWindowTabs(win.id);
      const usedNamesLower = new Set(Object.values(windowNames).map(n => (n || '').trim().toLowerCase()));
      name = findBestMatchingCustomName(fullWin, tabs, savedWindowRegistry, usedNamesLower, winIndex);
    }

    if (name) {
      windowNames[win.id] = name;
      await api.storage.local.set({ windowNames });
      await updateWindowTooltip(win.id, name);
    } else if (!isRestoringSession) {
      // User opened a NEW window dynamically after startup -> Prompt user to name window!
      setTimeout(async () => {
        try {
          await api.windows.create({
            url: api.runtime.getURL(`prompt/prompt.html?targetWindowId=${win.id}`),
            type: 'popup',
            width: 420,
            height: 220
          });
        } catch (err) {}
      }, 300);
    }

    await updateAllWindowTooltips();
    await syncWindowRegistry();
  } catch (e) {
    console.error('Error handling window onCreated:', e);
  }
});

// Update tooltips across all open windows with Hybrid Parallel-Fetch / Sequential-Assign Engine
async function updateAllWindowTooltips() {
  try {
    await purgeSingleLetterTestNames();
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    const windows = await api.windows.getAll();
    const validWindows = windows.filter(w => w.type !== 'popup');

    // Step 1: Parallel I/O Fetch (Lightning Fast 🚀)
    const windowsWithTabs = await Promise.all(validWindows.map(async (win, i) => {
      const tabs = await getWindowTabs(win.id);
      return { win, index: i, tabs };
    }));

    const usedNamesLower = new Set();

    // Step 2: Sequential Synchronous In-Memory Assignment (Zero Race Conditions 🛡️)
    for (const { win, index, tabs } of windowsWithTabs) {
      let name = windowNames[win.id];

      if (!name && isRestoringSession) {
        name = findBestMatchingCustomName(win, tabs, savedWindowRegistry, usedNamesLower, index);
        if (name) {
          windowNames[win.id] = name;
          usedNamesLower.add(name.trim().toLowerCase());
        }
      } else if (name) {
        const lower = name.trim().toLowerCase();
        if (usedNamesLower.has(lower)) {
          delete windowNames[win.id];
          name = null;
        } else {
          usedNamesLower.add(lower);
        }
      }

      if (name) {
        await updateWindowTooltip(win.id, name);
      }
    }

    await api.storage.local.set({ windowNames });
    await syncWindowRegistry();
  } catch (e) {
    console.error('Error updating window tooltips:', e);
  }
}

api.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) return;
  const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
  
  let name = windowNames[windowId];
  if (!name && isRestoringSession) {
    try {
      const win = await api.windows.get(windowId);
      if (win.type === 'popup') return;
      const allWins = await api.windows.getAll();
      const winIndex = allWins.findIndex(w => w.id === windowId);
      const tabs = await getWindowTabs(windowId);
      const usedNamesLower = new Set(Object.values(windowNames).map(n => (n || '').trim().toLowerCase()));
      
      name = findBestMatchingCustomName(win, tabs, savedWindowRegistry, usedNamesLower, winIndex);
      if (name) {
        windowNames[windowId] = name;
        await api.storage.local.set({ windowNames });
      }
    } catch (e) {}
  }

  if (name) {
    await updateWindowTooltip(windowId, name);
  }
});

api.windows.onRemoved.addListener(async (windowId) => {
  const { windowNames = {} } = await api.storage.local.get('windowNames');
  if (windowNames[windowId]) {
    delete windowNames[windowId];
    await api.storage.local.set({ windowNames });
    await syncWindowRegistry();
  }
});

// Update toolbar action tooltip
async function updateWindowTooltip(windowId, customName) {
  try {
    const title = customName ? `Window: ${customName}` : 'Window Switcher';
    if (api.action && api.action.setTitle) {
      await api.action.setTitle({ title, windowId });
    }
  } catch (e) {}
}

// Runtime message communication
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'GET_WINDOWS') {
        await purgeSingleLetterTestNames();
        const windows = await api.windows.getAll();
        const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
        const currentWin = await api.windows.getCurrent();
        const validWindows = windows.filter(win => win.type !== 'popup');

        // Step 1: Parallel I/O Fetch (Lightning Fast 🚀)
        const windowsWithTabs = await Promise.all(validWindows.map(async (win, winIndex) => {
          const tabs = await getWindowTabs(win.id);
          return { win, winIndex, tabs };
        }));

        const usedNamesLower = new Set();
        const result = [];

        // Step 2: Sequential Synchronous In-Memory Assignment (Zero Race Conditions 🛡️)
        for (const { win, winIndex, tabs } of windowsWithTabs) {
          let name = windowNames[win.id];

          if (name) {
            const lower = name.trim().toLowerCase();
            if (usedNamesLower.has(lower)) {
              name = null;
              delete windowNames[win.id];
            }
          }

          // ONLY match registry names during cold startup session restoration
          if (!name && isRestoringSession) {
            name = findBestMatchingCustomName(win, tabs, savedWindowRegistry, usedNamesLower, winIndex);
          }

          // Authoritative live tab query for this exact window (excluding pinned tabs)
          const unpinnedTabs = tabs.filter(t => !t.pinned);
          const exactTabCount = unpinnedTabs.length > 0 ? unpinnedTabs.length : (tabs ? tabs.length : 0);
          
          const activeTab = tabs ? tabs.find(t => t.active) || tabs[0] : null;
          const tabTitle = activeTab && activeTab.title ? activeTab.title : '';

          if (name) {
            usedNamesLower.add(name.trim().toLowerCase());
            windowNames[win.id] = name;
          } else {
            // Clean fallback: Use active tab title or Window #ID (NOT saved into custom windowNames)
            name = tabTitle ? tabTitle : `Window #${win.id}`;
          }

          result.push({
            id: win.id,
            name: name,
            focused: win.id === currentWin.id,
            tabCount: exactTabCount,
            activeTabTitle: tabTitle
          });
        }

        await api.storage.local.set({ windowNames });
        await syncWindowRegistry();
        
        sendResponse({ success: true, windows: result, currentWindowId: currentWin.id });
      } 
      else if (message.type === 'SET_WINDOW_NAME') {
        const { windowId, name } = message;
        const sanitizedName = (name || '').trim().slice(0, 50);

        if (sanitizedName) {
          const liveWindows = await api.windows.getAll();
          const { windowNames = {} } = await api.storage.local.get('windowNames');
          const lowerNew = sanitizedName.toLowerCase();

          for (const win of liveWindows) {
            if (win.type === 'popup') continue;
            if (win.id !== windowId) {
              const existingName = (windowNames[win.id] || '').trim().toLowerCase();
              if (existingName === lowerNew) {
                sendResponse({ success: false, error: 'DUPLICATE_NAME', duplicateName: sanitizedName });
                return;
              }
            }
          }

          windowNames[windowId] = sanitizedName;
        } else {
          const { windowNames = {} } = await api.storage.local.get('windowNames');
          delete windowNames[windowId];
          await api.storage.local.set({ windowNames });
        }
        
        const { windowNames: updatedNames = {} } = await api.storage.local.get('windowNames');
        if (sanitizedName) {
          updatedNames[windowId] = sanitizedName;
        } else {
          delete updatedNames[windowId];
        }
        await api.storage.local.set({ windowNames: updatedNames });
        
        await syncWindowRegistry();
        await updateWindowTooltip(windowId, sanitizedName);

        sendResponse({ success: true, name: sanitizedName });
      }
      else if (message.type === 'CLEAR_ALL_NAMES') {
        await api.storage.local.set({ windowNames: {}, savedWindowRegistry: [] });
        sendResponse({ success: true });
      }
      else if (message.type === 'FOCUS_WINDOW') {
        const { windowId } = message;
        const numId = parseInt(windowId, 10);
        if (numId) {
          await api.windows.update(numId, { focused: true });
        }
        sendResponse({ success: true });
      }
      else if (message.type === 'GET_WINDOW_NAME') {
        const windowId = message.windowId || (sender.tab ? sender.tab.windowId : null);
        const { windowNames = {} } = await api.storage.local.get('windowNames');
        const name = windowId && windowNames[windowId] ? windowNames[windowId] : '';
        sendResponse({ 
          success: true, 
          windowName: name
        });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});
