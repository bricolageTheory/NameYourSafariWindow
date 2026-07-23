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

// Global flag to prevent name overwrites during initial browser launch session restore
let isRestoringSession = true;
setTimeout(() => {
  isRestoringSession = false;
}, 5000); // 5-second lock on startup

// Initialize default storage
api.runtime.onInstalled.addListener(async () => {
  const data = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
  if (!data.windowNames) await api.storage.local.set({ windowNames: {} });
  if (!data.savedWindowRegistry) await api.storage.local.set({ savedWindowRegistry: [] });
  await updateAllWindowTooltips();
});

// Sync active window sessions to persistent registry
async function syncWindowRegistry() {
  try {
    const windows = await api.windows.getAll({ populate: true });
    const { windowNames = {} } = await api.storage.local.get('windowNames');
    
    const updatedRegistry = [];

    for (const win of windows) {
      if (win.type === 'popup') continue;
      const name = windowNames[win.id];
      if (name) {
        const fp = getWindowFingerprint(win);
        updatedRegistry.push({
          name: name,
          count: fp ? fp.count : (win.tabs ? win.tabs.length : 1),
          titles: fp ? fp.titles : [],
          activeIndex: fp ? fp.activeIndex : 0,
          signature: fp ? fp.signature : ''
        });
      }
    }

    await api.storage.local.set({ savedWindowRegistry: updatedRegistry });
  } catch (e) {}
}

api.tabs.onCreated.addListener((tab) => { if (tab.windowId) syncWindowRegistry(); });
api.tabs.onRemoved.addListener((tabId, removeInfo) => { if (removeInfo.windowId) syncWindowRegistry(); });
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (tab.windowId) syncWindowRegistry(); });

// Best-match algorithm using Titles, Count, and macOS Z-Order Index
function findBestMatchingCustomName(win, winIndex, savedWindowRegistry, usedNames) {
  if (!win || !savedWindowRegistry || savedWindowRegistry.length === 0) return null;

  const fp = getWindowFingerprint(win);
  let bestMatch = null;
  let highestScore = -1;

  // Pass 1: Title & Tab Count Match
  for (let i = 0; i < savedWindowRegistry.length; i++) {
    const saved = savedWindowRegistry[i];
    if (!saved || !saved.name || usedNames.has(saved.name)) continue;

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
    if (savedAtPos && savedAtPos.name && !usedNames.has(savedAtPos.name)) {
      bestMatch = savedAtPos.name;
    }
  }

  return bestMatch;
}

// Window creation listener (Strict startup guard)
api.windows.onCreated.addListener(async (win) => {
  if (!win || win.id === api.windows.WINDOW_ID_NONE || win.type === 'popup') return;
  if (isRestoringSession) return;

  try {
    const fullWin = await api.windows.get(win.id, { populate: true });
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    
    let name = windowNames[win.id];

    if (!name) {
      const allWins = await api.windows.getAll({ populate: true });
      const winIndex = allWins.findIndex(w => w.id === win.id);
      const usedNames = new Set(Object.values(windowNames));
      name = findBestMatchingCustomName(fullWin, winIndex, savedWindowRegistry, usedNames);
    }

    if (name) {
      windowNames[win.id] = name;
      await api.storage.local.set({ windowNames });
      await updateWindowTooltip(win.id, name);
    }
  } catch (e) {
    console.error('Error handling window onCreated:', e);
  }
});

// Update tooltips across all open windows
async function updateAllWindowTooltips() {
  try {
    const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
    const windows = await api.windows.getAll({ populate: true });
    const validWindows = windows.filter(w => w.type !== 'popup');
    const usedNames = new Set();

    for (let i = 0; i < validWindows.length; i++) {
      const win = validWindows[i];
      let name = windowNames[win.id];

      if (!name) {
        name = findBestMatchingCustomName(win, i, savedWindowRegistry, usedNames);
        if (name) {
          windowNames[win.id] = name;
          usedNames.add(name);
        }
      } else {
        usedNames.add(name);
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
      const usedNames = new Set(Object.values(windowNames));
      
      name = findBestMatchingCustomName(win, winIndex, savedWindowRegistry, usedNames);
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
        const windows = await api.windows.getAll({ populate: true });
        const { windowNames = {}, savedWindowRegistry = [] } = await api.storage.local.get(['windowNames', 'savedWindowRegistry']);
        const currentWin = await api.windows.getCurrent();
        const validWindows = windows.filter(win => win.type !== 'popup');
        const usedNames = new Set();
        
        const result = validWindows.map((win, winIndex) => {
          let name = windowNames[win.id];

          if (!name) {
            name = findBestMatchingCustomName(win, winIndex, savedWindowRegistry, usedNames);
          }

          const activeTab = win.tabs ? win.tabs.find(t => t.active) || win.tabs[0] : null;
          const tabTitle = activeTab && activeTab.title ? activeTab.title : '';

          if (!name) {
            name = tabTitle ? tabTitle : `Window #${win.id}`;
          }

          usedNames.add(name);
          windowNames[win.id] = name;

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
        updatedNames[windowId] = sanitizedName;
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
