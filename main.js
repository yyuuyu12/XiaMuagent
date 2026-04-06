const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const {
  getPythonModulesDir,
  getDataDir,
  getResourcesDir,
  initDirectories
} = require('./utils/pathUtils');
// 初始化日志服务（会自动挂载到 global.logger）
require('./utils/logger');

// 禁用开发环境的安全警告
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 忽略 SSL 证书验证错误（修复 unable to verify the first certificate）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 禁用 GPU 硬件加速（解决部分电脑显卡驱动不兼容导致崩溃的问题）
// app.disableHardwareAcceleration();

// 设置 Playwright 浏览器路径
if (app.isPackaged) {
  // 打包后：resources/playwright
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright');
} else {
  // 开发环境：项目根目录/resources/playwright
  // 假设 main.js 在 electron/main/main.js，所以需要回退两层到根目录
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '../../resources/playwright');
}

// 环境判断
const isPackaged = app.isPackaged;
const isDev = !isPackaged;

let mainWindow;

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  return;
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当运行第二个实例时,将会聚焦到myWindow这个窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}


// ChromaDB 进程
let chromaProcess = null;
// ChromaDB 心跳检测定时器
let chromaHeartbeatTimer = null;

// IPC处理器
const { registerPythonIpc, setMainWindow: setMainWindowForPython } = require('./ipc/pythonIpc');
const { registerFileIpc } = require('./ipc/fileIpc');  // 统一文件操作IPC
const { registerDbIpc, registerDatabaseBackupIpc } = require('./ipc/dbIpc');  // 统一数据库IPC（CRUD操作）
const { registerAccountIpc } = require('./ipc/accountIpc');  // 账号业务逻辑IPC
const { registerVectorIpc } = require('./ipc/vectorIpc');  // 向量服务IPC
const { heartbeat } = require('./services/vectorService');  // 向量服务心跳检测
const { initMaterialIpc, setConfigService: setMaterialConfigService } = require('./ipc/materialIpc');  // 素材业务逻辑IPC
const { registerPublishIpcHandlers } = require('./ipc/publishIpc');  // 发布业务逻辑IPC
const { registerVideoIpc } = require('./ipc/videoIpc');  // 视频处理IPC
require('./ipc/videoRenderIPC');  // 视频渲染IPC - 自动注册
const { registerTaskIpc, initTaskServices, setMainWindow } = require('./ipc/taskIpc');  // 任务队列IPC
const { initConfigService, registerConfigIpc, getConfigService } = require('./ipc/configIpc');  // 配置管理IPC
const { initLLMService, registerLLMIpc } = require('./ipc/llmIpc');  // LLM服务IPC
const { registerCloudIpc } = require('./ipc/cloudIpc');  // 云端服务IPC
const { registerOssIpc, initOssService } = require('./ipc/ossIpc');  // OSS上传服务IPC
const { registerUserIpc } = require('./ipc/userIpc');  // 用户业务逻辑IPC
const { registerOemIpc } = require('./ipc/oemIpc');  // OEM配置IPC
const { initDraftService, registerDraftIpc } = require('./ipc/draftIpc');  // 草稿服务IPC
const { initVideoParserService, registerVideoParserIpc } = require('./ipc/videoParserIpc');  // 视频解析服务IPC
const { initVideoCompositionService, registerVideoCompositionIpc } = require('./ipc/videoCompositionIpc');  // 视频合成服务IPC
const { initFontService, registerFontIpc } = require('./ipc/fontIpc');  // 字体服务IPC
const { registerLoggerIpc } = require('./ipc/loggerIpc');  // 日志服务IPC
const { initDatabase } = require('./services/database/database');
const { ipcMain } = require('electron');

/**
 * 启动 ChromaDB 服务（直接使用 venv 中的 chroma）
 * 异步启动，不阻塞主应用
 */
function startChromaDB() {
  // 数据目录
  const dataPath = path.join(getDataDir(), 'chromadb');

  // 可执行文件路径（根据平台和架构选择）
  let chromaExecName;
  if (process.platform === 'win32') {
    chromaExecName = 'chroma-windows.exe';
  } else if (process.platform === 'darwin') {
    // macOS 需要根据架构选择
    if (process.arch === 'arm64') {
      chromaExecName = 'chroma-macos-arm64';
    } else {
      chromaExecName = 'chroma-macos-intel';
    }
  } else {
    chromaExecName = 'chroma-linux';
  }

  const chromaExe = path.join(getResourcesDir(), 'chromadb', chromaExecName);

  global.logger.info('ChromaDB数据目录:', dataPath);
  global.logger.info('ChromaDB可执行文件:', chromaExe);

  // 创建数据目录
  if (!fs.existsSync(dataPath)) {
    try {
      fs.mkdirSync(dataPath, { recursive: true });
      global.logger.info('创建ChromaDB数据目录');
    } catch (error) {
      global.logger.error('创建ChromaDB数据目录失败:', error);
      return;
    }
  }

  // 检查可执行文件是否存在
  if (!fs.existsSync(chromaExe)) {
    global.logger.warn(`ChromaDB 可执行文件不存在: ${chromaExe}`);
    global.logger.warn('ChromaDB服务将不会启动，某些功能可能不可用');
    return;
  }

  // 确保可执行文件有执行权限（macOS/Linux）
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(chromaExe, '755');
      global.logger.info('✓ ChromaDB 可执行文件权限已设置');
    } catch (error) {
      global.logger.warn('⚠️  设置 ChromaDB 权限失败:', error.message);
    }
  }

  global.logger.info('启动 ChromaDB 服务器...');

  // 根据是否打包版本使用不同的启动参数
  const spawnArgs = [
    'run',
    '--host', 'localhost',
    '--port', '8521',
    '--path', dataPath
  ];
  // export CHROMA_CORS_ALLOW_ORIGINS='["http://localhost:8521"]'

  const spawnOptions = {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: path.dirname(chromaExe), // 设置工作目录到可执行文件所在目录
    env: {
      ...process.env,
      CHROMADB_DATA_PATH: dataPath, // 传递数据路径环境变量
      // 注意：Chroma 官方要求使用 CHROMA_CORS_ALLOW_ORIGINS，值为 JSON 字符串
      CHROMA_SERVER_CORS_ALLOW_ORIGINS: '["http://localhost:8521","http://localhost:3000","*"]',
      CHROMA_CORS_ALLOW_ORIGINS: '["http://localhost:8521","http://localhost:3000","*"]',
      ALLOW_RESET: 'TRUE' // 允许重置
    }
  };

  // 启动 chroma-windows.exe
  chromaProcess = spawn(chromaExe, spawnArgs, spawnOptions);

  // 监听输出
  chromaProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      global.logger.info(`[ChromaDB] ${output}`);
    }
  });

  chromaProcess.stderr.on('data', (data) => {
    const output = data.toString();
    if (!output.includes('WARNING') && !output.includes('OpenTelemetry')) {
      global.logger.error(`[ChromaDB Error] ${output.trim()}`);
    }
  });

  chromaProcess.on('error', (error) => {
    global.logger.error('ChromaDB 启动失败:', error.message);
  });

  chromaProcess.on('exit', (code, signal) => {
    global.logger.info(`ChromaDB 进程已退出，code=${code}, signal=${signal ?? 'null'}`);
    chromaProcess = null;
    // 进程退出时清除心跳定时器
    if (chromaHeartbeatTimer) {
      clearInterval(chromaHeartbeatTimer);
      chromaHeartbeatTimer = null;
    }
  });

  chromaProcess.on('close', (code, signal) => {
    global.logger.info(`ChromaDB 进程已关闭，code=${code}, signal=${signal ?? 'null'}`);
    // 进程关闭时清除心跳定时器
    if (chromaHeartbeatTimer) {
      clearInterval(chromaHeartbeatTimer);
      chromaHeartbeatTimer = null;
    }
  });

  global.logger.info('ChromaDB 启动完成');

  // 等待服务完全启动后开始定时心跳检测（延迟5秒）
  setTimeout(() => {
    startChromaHeartbeat();
  }, 5000);
}

/**
 * 启动 ChromaDB 心跳检测（每30秒检测一次）
 */
function startChromaHeartbeat() {
  // 如果已有定时器，先清除
  if (chromaHeartbeatTimer) {
    clearInterval(chromaHeartbeatTimer);
  }

  global.logger.info('开始 ChromaDB 心跳检测（每30秒）');

  // 立即执行一次心跳检测
  performHeartbeat();

  // 设置定时器，每30秒执行一次
  chromaHeartbeatTimer = setInterval(() => {
    performHeartbeat();
  }, 60000);
}

/**
 * 执行心跳检测
 */
async function performHeartbeat() {
  try {
    const result = await heartbeat();
    if (result.success) {
      global.logger.info('ChromaDB 心跳检测正常');
    } else {
      global.logger.warn('ChromaDB 心跳检测失败:', result.message);
    }
  } catch (error) {
    global.logger.error('ChromaDB 心跳检测异常:', error.message);
  }
}

/**
 * 停止 ChromaDB 服务
 */
function stopChromaDB() {
  // 清除心跳定时器
  if (chromaHeartbeatTimer) {
    clearInterval(chromaHeartbeatTimer);
    chromaHeartbeatTimer = null;
    global.logger.info('已停止 ChromaDB 心跳检测');
  }

  if (chromaProcess) {
    global.logger.info('正在关闭 ChromaDB 服务器...');
    const pid = chromaProcess.pid;
    let forceKillTimer = null;
    global.logger.info('ChromaDB进程ID:', pid);
    // 超时后强制结束，避免端口占用
    forceKillTimer = setTimeout(() => {
      try {
        global.logger.warn(`优雅关闭超时，强制结束进程 PID=${pid}`);
        const { spawn } = require('child_process');
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        } else {
          // macOS/Linux 使用 kill -9
          spawn('kill', ['-9', String(pid)]);
        }
      } catch (e) {
        global.logger.error('强制结束 ChromaDB 进程失败:', e.message);
      }
    }, 3000);

    chromaProcess.once('exit', () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
    });

    // 发送优雅退出信号
    try {
      chromaProcess.kill('SIGTERM');
    } catch (e) {
      global.logger.warn('发送SIGTERM失败，尝试强制结束');
      try {
        const { spawn } = require('child_process');
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        } else {
          // macOS/Linux 使用 kill -9
          spawn('kill', ['-9', String(pid)]);
        }
      } catch (e2) {
        global.logger.error('强制结束失败:', e2.message);
      }
    }

    chromaProcess = null;
  }
}


/**
 * 创建主窗口
 */
function createWindow() {

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    icon: path.join(__dirname, '../../resources/logo_icon.png'),
    frame: false, // 去掉边框
    show: false, // 先不显示，等完全准备好再显示
    backgroundColor: '#f0f2f5' // 设置背景色，避免白屏闪烁
  });

  // 加载页面
  if (isPackaged) {
    const { pathToFileURL } = require('url');
    const indexPath = path.join(__dirname, '../renderer/dist/index.html');
    mainWindow.loadURL(pathToFileURL(indexPath).toString());
  } else {
    mainWindow.loadURL('http://localhost:8527');
  }

  // 开发环境显示调试工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 添加调试快捷键 (Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // 主页面加载完成
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    global.logger.error('主页面加载失败:', errorCode, errorDescription);
  });

  // 监听右键菜单事件
  mainWindow.webContents.on('context-menu', (event, params) => {
    // 仅在可编辑区域(如输入框)或有选中文本时显示右键菜单
    if (params.isEditable || params.selectionText) {
      const template = [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'delete', label: '删除' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' }
      ];
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });

  // 等待窗口完全准备好再显示
  mainWindow.once('ready-to-show', () => {
    // 设置主窗口引用
    setMainWindow(mainWindow);

    // 显示窗口
    mainWindow.show();

    // 确保窗口获得焦点
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 当主窗口关闭时，退出应用
    app.quit();
  });
}

/**
 * 注册窗口控制IPC
 */
function registerWindowControlIpc() {
  // 最小化窗口
  ipcMain.handle('window-minimize', () => {
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  // 最大化窗口
  ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
      if (process.platform === 'darwin') {
        mainWindow.setFullScreen(true);
      } else {
        mainWindow.maximize();
      }
      return { isMaximized: true };
    }
    return { isMaximized: false };
  });

  // 还原窗口
  ipcMain.handle('window-unmaximize', () => {
    if (mainWindow) {
      if (process.platform === 'darwin') {
        mainWindow.setFullScreen(false);
      } else {
        mainWindow.unmaximize();
      }
      return { isMaximized: false };
    }
    return { isMaximized: false };
  });

  // 关闭窗口
  ipcMain.handle('window-close', () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  // 开始拖动
  ipcMain.handle('window-start-drag', () => {
    if (mainWindow) {
      // 在Windows上，可以通过模拟鼠标事件来实现拖动
      // 这里使用一个简单的方法
      const { screen } = require('electron');
      const cursor = screen.getCursorScreenPoint();
      mainWindow.setPosition(cursor.x - 100, cursor.y - 10);
    }
  });
}

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);

    global.logger.info('AIGC Human 应用启动中...');
    global.logger.info('初始化目录结构...');

    // 显示环境信息
    global.logger.info('环境信息:');
    global.logger.info('  - NODE_ENV:', process.env.NODE_ENV);
    global.logger.info('  - isDev:', isDev);
    global.logger.info('  - isPackaged:', isPackaged);
    global.logger.info('  - 应用路径:', process.resourcesPath);
    global.logger.info('  - 可执行文件路径:', process.execPath);
    global.logger.info('  - 用户数据目录:', app.getPath('userData'));
    global.logger.info('  - 可执行文件目录:', path.dirname(app.getPath('exe')));

    // 初始化目录结构
    initDirectories();

    // 检查Python模块目录
    const pythonModulesDir = getPythonModulesDir();
    global.logger.info('Python模块目录:', pythonModulesDir);
    if (fs.existsSync(pythonModulesDir)) {
      try {
        const modules = fs.readdirSync(pythonModulesDir);
        global.logger.info('  - 找到模块:', modules.join(', '));
      } catch (error) {
        global.logger.info('  - 读取模块目录失败:', error.message);
      }
    } else {
      global.logger.info('  - Python模块目录不存在');
    }

    // 后台启动 ChromaDB 服务（不等待）
    startChromaDB();

    // 初始化数据库
    await initDatabase();

    // 初始化默认声音样本数据
    const { initDefaultVoiceSamples } = require('./services/voiceModelInitService');
    await initDefaultVoiceSamples();

    // 初始化默认数字人数据
    const { initDefaultDigitalHumans } = require('./services/digitalHumanInitService');
    await initDefaultDigitalHumans();

    // 注册数据库相关IPC
    registerDbIpc();
    registerDatabaseBackupIpc();

    // 注册Python IPC
    registerPythonIpc();

    // 初始化各种服务
    await initConfigService();
    await initLLMService();
    await initDraftService();
    await initVideoParserService();
    await initVideoCompositionService();
    await initFontService();
    initOssService();
    await initTaskServices();

    // 注入配置服务到素材服务
    const configService = getConfigService();
    if (configService) {
      setMaterialConfigService(configService);
    }

    // 注册所有IPC处理器
    registerConfigIpc();
    registerLLMIpc();
    registerDraftIpc();
    registerVideoParserIpc();
    const { registerIpBrainIpc } = require('./ipc/ipBrainIpc'); // 新增
    registerVideoCompositionIpc();
    registerIpBrainIpc(); // 新增注册
    registerFontIpc();
    registerFileIpc();
    registerAccountIpc();
    registerVectorIpc();
    registerVideoIpc();
    registerCloudIpc();
    registerOemIpc();
    registerOssIpc();
    registerUserIpc(createWindow);
    initMaterialIpc();
    await registerPublishIpcHandlers();
    registerTaskIpc();
    registerLoggerIpc();  // 日志服务IPC
    require('./ipc/coverIpc')(); // 封面生成IPC
    require('./ipc/audioIpc')(); // 音频处理IPC

    // 创建主窗口
    createWindow();

    // 注册窗口控制IPC
    registerWindowControlIpc();

    global.logger.info('应用初始化完成');
  } catch (error) {
    global.logger.error('应用初始化失败:', error);
    global.logger.error(error.stack);
    process.exit(1);
  }
}).catch(error => {
  global.logger.error('应用启动失败:', error);
  global.logger.error(error.stack);
  process.exit(1);
});

app.on('window-all-closed', () => {
  // 停止 ChromaDB 服务
  stopChromaDB();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  // 应用退出前停止 ChromaDB
  stopChromaDB();
});

// AIGC Human 应用已启动
