// Service Worker for Safari Window Naming & Switcher Extension
const api = typeof browser !== 'undefined' ? browser : chrome;

// Compute a stable title-based fingerprint for a window
function getWindowFingerprint(win) {
  if (!win || !win.tabs || win.tabs.length === 0) return null;
  const titles = win.tabs.map(t => (t.title || '').toLowerCase().trim()).filter(Boolean);
  const activeIndex = win.tabs.findIndex(t => t.active);
  return {
    count: win.tabs.length,
    titles: titles,
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
    signature: `sig:${win.tabs.length}:${activeIndex}:${titles.slice(0, 3).join('|')}`
  };
}

// Automatic Storage Deduplication Migration
async function cleanAndDeduplicateStorage() {
  try {
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    
    // Deduplicate savedWindowRegistry by unique name
    const uniqueRegistryMap = new Map();
    for (const entry of savedWindowRegistry) {
      if (entry && entry.name) {
        const lower = entry.name.trim().toLowerCase();
        if (!uniqueRegistryMap.has(lower)) {
          uniqueRegistryMap.set(lower, entry);
        }
      }
    }
    const cleanedRegistry = Array.from(uniqueRegistryMap.values());

    // Deduplicate active windowNames
    const usedNamesLower = new Set();
    const cleanedWindowNames = {};
    for (const [winId, name] of Object.entries(windowNames)) {
      if (name) {
        const lower = name.trim().toLowerCase();
        if (!usedNamesLower.has(lower)) {
          usedNamesLower.add(lower);
          cleanedWindowNames[winId] = name;
        }
      }
    }

    await api.storage.local.set({
      windowNames: cleanedWindowNames,
      savedWindowRegistry: cleanedRegistry
    });
  } catch (e) {
    console.error('Error cleaning storage:', e);
  }
}

// Global flag to prevent name overwrites during initial browser launch session restore
let isRestoringSession = true;
setTimeout(() => {
  isRestoringSession = false;
}, 5000); // 5-second lock on startup

// Initialize default storage & clean duplicates
api.runtime.onInstalled.addListener(async () => {
  const data = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
  if (!data.windowNames) await api.storage.local.set({ windowNames: {} });
  if (!data.savedWindowRegistry) await api.storage.local.set({ savedWindowRegistry: [] });
  await cleanAndDeduplicateStorage();
  await updateAllWindowTooltips();
});

// Run storage cleanup on service worker launch
cleanAndDeduplicateStorage();

// Sync active window sessions to persistent registry
async function syncWindowRegistry() {
  try {
    const windows = await api.windows.getAll({ populate: true });
    const { windowNames = {} } = await api.storage.local.get('windowNames');
    
    const updatedRegistryMap = new Map();

    for (const win of windows) {
      if (win.type === 'popup') continue;
      const name = windowNames[win.id];
      if (name) {
        const lower = name.trim().toLowerCase();
        if (!updatedRegistryMap.has(lower)) {
          const fp = getWindowFingerprint(win);
          updatedRegistryMap.set(lower, {
            name: name,
            count: fp ? fp.count : (win.tabs ? win.tabs.length : 1),
            titles: fp ? fp.titles : [],
            activeIndex: fp ? fp.activeIndex : 0,
            signature: fp ? fp.signature : ''
          });
        }
      }
    }

    await api.storage.local.set({ savedWindowRegistry: Array.from(updatedRegistryMap.values()) });
  } catch (e) {}
}

api.tabs.onCreated.addListener((tab) => { if (tab.windowId) syncWindowRegistry(); });
api.tabs.onRemoved.addListener((tabId, removeInfo) => { if (removeInfo.windowId) syncWindowRegistry(); });
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (tab.windowId) syncWindowRegistry(); });

// Best-match algorithm using Titles, Count, and macOS Z-Order Index with strict uniqueness
function findBestMatchingCustomName(win, winIndex, savedWindowRegistry, usedNamesLower) {
  if (!win || !savedWindowRegistry || savedWindowRegistry.length === 0) return null;

  const fp = getWindowFingerprint(win);
  let bestMatch = null;
  let highestScore = -1;

  // Pass 1: Title & Tab Count Match
  for (let i = 0; i < savedWindowRegistry.length; i++) {
    const saved = savedWindowRegistry[i];
    if (!saved || !saved.name) continue;
    const lowerName = saved.name.trim().toLowerCase();
    if (usedNamesLower.has(lowerName)) continue;

    let score = 0;

    // Exact or close tab count match
    if (fp && saved.count === fp.count) {
      score += 40;
    } else if (fp && Math.abs(saved.count - fp.count) <= 2) {
      score += 15;
    }

    // Title sequence match
    if (fp && fp.titles.length > 0 && saved.titles && saved.titles.length > 0) {
      let titleMatches = 0;
      for (const t of fp.titles) {
        if (saved.titles.some(st => st.includes(t) || t.includes(st))) {
          titleMatches++;
        }
      }
      score += (titleMatches * 20);
    }

    // Active index match
    if (fp && saved.activeIndex === fp.activeIndex) {
      score += 10;
    }

    if (score > highestScore && score >= 20) {
      highestScore = score;
      bestMatch = saved.name;
    }
  }

  // Pass 2: Positional Z-Order Match (for identical or unloaded windows)
  if (!bestMatch && savedWindowRegistry[winIndex]) {
    const savedAtPos = savedWindowRegistry[winIndex];
    if (savedAtPos && savedAtPos.name) {
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
    const fullWin = await api.windows.get(win.id, { populate: true });
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    
    let name = windowNames[win.id];

    if (!name && isRestoringSession) {
      const allWins = await api.windows.getAll({ populate: true });
      const winIndex = allWins.findIndex(w => w.id === win.id);
      const usedNamesLower = new Set(Object.values(windowNames).map(n => (n || '').trim().toLowerCase()));
      name = findBestMatchingCustomName(fullWin, winIndex, savedWindowRegistry, usedNamesLower);
    }

    if (name) {
      windowNames[win.id] = name;
      await api.storage.local.set({ windowNames });
      await updateWindowTooltip(win.id, name);
    } else if (!isRestoringSession) {
      // User opened a NEW window dynamically -> Prompt user to name window!
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

// Update tooltips across all open windows with strict uniqueness
async function updateAllWindowTooltips() {
  try {
    await cleanAndDeduplicateStorage();
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    const windows = await api.windows.getAll({ populate: true });
    const validWindows = windows.filter(w => w.type !== 'popup');
    const usedNamesLower = new Set();

    for (let i = 0; i < validWindows.length; i++) {
      const win = validWindows[i];
      let name = windowNames[win.id];

      if (!name) {
        name = findBestMatchingCustomName(win, i, savedWindowRegistry, usedNamesLower);
        if (name) {
          windowNames[win.id] = name;
          usedNamesLower.add(name.trim().toLowerCase());
        }
      } else {
        const lower = name.trim().toLowerCase();
        if (usedNamesLower.has(lower)) {
          // DUPLICATE DETECTED IN ACTIVE SESSION -> CLEAR DUPLICATE
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
  } catch (e) {
    console.error('Error updating window tooltips:', e);
  }
}

api.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) return;
  const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
  
  let name = windowNames[windowId];
  if (!name) {
    try {
      const win = await api.windows.get(windowId, { populate: true });
      if (win.type === 'popup') return;
      const allWins = await api.windows.getAll({ populate: true });
      const winIndex = allWins.findIndex(w => w.id === windowId);
      const usedNamesLower = new Set(Object.values(windowNames).map(n => (n || '').trim().toLowerCase()));
      
      name = findBestMatchingCustomName(win, winIndex, savedWindowRegistry, usedNamesLower);
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
        await cleanAndDeduplicateStorage();
        const windows = await api.windows.getAll({ populate: true });
        const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
        const currentWin = await api.windows.getCurrent();
        const validWindows = windows.filter(win => win.type !== 'popup');
        const usedNamesLower = new Set();
        
        const result = validWindows.map((win, winIndex) => {
          let name = windowNames[win.id];

          if (name) {
            const lower = name.trim().toLowerCase();
            if (usedNamesLower.has(lower)) {
              // DUPLICATE IN STORAGE DETECTED -> CLEAR FROM THIS WINDOW
              name = null;
              delete windowNames[win.id];
            }
          }

          if (!name) {
            name = findBestMatchingCustomName(win, winIndex, savedWindowRegistry, usedNamesLower);
          }

          const activeTab = win.tabs ? win.tabs.find(t => t.active) || win.tabs[0] : null;
          const tabTitle = activeTab && activeTab.title ? activeTab.title : '';

          if (name) {
            usedNamesLower.add(name.trim().toLowerCase());
            windowNames[win.id] = name;
          } else {
            // Clean fallback: Use active tab title or Window #ID (NOT saved into custom windowNames)
            name = tabTitle ? tabTitle : `Window #${win.id}`;
          }

          return {
            id: win.id,
            name: name,
            focused: win.id === currentWin.id,
            tabCount: win.tabs ? win.tabs.length : 0,
            activeTabTitle: tabTitle
          };
        });

        await api.storage.local.set({ windowNames });
        await syncWindowRegistry();
        
        sendResponse({ success: true, windows: result, currentWindowId: currentWin.id });
      } 
      else if (message.type === 'SET_WINDOW_NAME') {
        const { windowId, name } = message;
        const sanitizedName = (name || '').trim().slice(0, 50);

        if (sanitizedName) {
          const liveWindows = await api.windows.getAll({ populate: true });
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
