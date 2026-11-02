const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')

let mainWindow = null
let gatewayProcess = null

const GATEWAY_PORT = 8766
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/health`

function getPythonPath() {
  const venvPython = path.join(__dirname, '..', '.venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) {
    return venvPython
  }
  return 'python3'
}

function startSovereignGateway() {
  const pythonBin = getPythonPath()
  const scriptPath = path.join(__dirname, '..', 'server', 'gateway.py')

  console.log(`[EDITH Desktop] Spawning Sovereign Engine: ${pythonBin} ${scriptPath}`)

  gatewayProcess = spawn(pythonBin, [scriptPath, '--port', String(GATEWAY_PORT)], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  gatewayProcess.stdout.on('data', (data) => {
    console.log(`[Sovereign Engine] ${data.toString().trim()}`)
  })

  gatewayProcess.stderr.on('data', (data) => {
    console.error(`[Sovereign Engine Error] ${data.toString().trim()}`)
  })

  gatewayProcess.on('exit', (code, signal) => {
    console.log(`[Sovereign Engine] exited with code ${code}, signal ${signal}`)
  })
}

function stopSovereignGateway() {
  if (gatewayProcess) {
    console.log('[EDITH Desktop] Stopping Sovereign Engine subprocess...')
    try {
      gatewayProcess.kill('SIGTERM')
    } catch (err) {
      console.error('[EDITH Desktop] Error terminating backend:', err)
    }
    gatewayProcess = null
  }
}

function waitForGateway(timeoutMs = 12000) {
  const start = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(GATEWAY_URL, (res) => {
        if (res.statusCode === 200) {
          resolve(true)
        } else if (Date.now() - start < timeoutMs) {
          setTimeout(check, 300)
        } else {
          resolve(false)
        }
      })
      req.on('error', () => {
        if (Date.now() - start < timeoutMs) {
          setTimeout(check, 300)
        } else {
          resolve(false)
        }
      })
      req.end()
    }
    check()
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0a0b0e',
    title: 'EDITH — Sovereign AI Operating System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
    },
    autoHideMenuBar: true,
  })

  // Sanitize User-Agent so Google OAuth and Identity Services don't block requests with 403: disallowed_useragent
  const originalUA = mainWindow.webContents.getUserAgent()
  const cleanUA = originalUA.replace(/\s*Electron\/[0-9.]+/i, '')
  mainWindow.webContents.setUserAgent(cleanUA)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          userAgent: cleanUA,
          autoHideMenuBar: true,
        },
      }
    }
    return { action: 'allow' }
  })

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[EDITH Desktop Error] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`)
  })

  const isPreview = process.env.ELECTRON_PREVIEW === '1' || process.env.NODE_ENV === 'production'
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html')

  if (isPreview || !fs.existsSync(indexPath)) {
    if (fs.existsSync(indexPath)) {
      console.log(`[EDITH Desktop] Loading production bundle: ${indexPath}`)
      await mainWindow.loadFile(indexPath)
    } else {
      console.log(`[EDITH Desktop] Dist not found, loading URL: ${devUrl}`)
      await mainWindow.loadURL(devUrl)
    }
  } else if (process.env.NODE_ENV === 'development') {
    console.log(`[EDITH Desktop] Dev mode active, loading URL: ${devUrl}`)
    try {
      await mainWindow.loadURL(devUrl)
    } catch (err) {
      console.warn('[EDITH Desktop] Dev server unreachable, falling back to dist/index.html')
      await mainWindow.loadFile(indexPath)
    }
  } else {
    console.log(`[EDITH Desktop] Loading local bundle: ${indexPath}`)
    await mainWindow.loadFile(indexPath)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC Handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close()
})

ipcMain.handle('app-version', () => app.getVersion())

ipcMain.handle('open-external-url', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url)
    return true
  }
  return false
})

ipcMain.handle('dialog-select-directory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

// App Lifecycle
app.whenReady().then(async () => {
  startSovereignGateway()
  await waitForGateway()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopSovereignGateway()
})

app.on('will-quit', () => {
  stopSovereignGateway()
})

process.on('SIGINT', () => {
  stopSovereignGateway()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopSovereignGateway()
  process.exit(0)
})
