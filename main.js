const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const AUDIO_BITRATE_KBPS = 128;
let mainWindow;
let ffmpegProcess = null;
let cancelCompressionFlag = false;

const preloadPath = path.join(__dirname, 'preload.js');
console.log(`[main.js] Variável __dirname é: ${__dirname}`);
console.log('[main.js] Tentando carregar o script de preload de (caminho resolvido):', preloadPath);
console.log('[main.js] O script de preload existe nesse caminho (verificado com fs.existsSync)?', fs.existsSync(preloadPath));

function createWindow() {
    console.log('[main.js] createWindow chamada. Usando preloadPath:', preloadPath);
    mainWindow = new BrowserWindow({
        width: 1300,
        height: 630,
        minWidth: 1300,
        minHeight: 630,
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
        // icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (ffmpegProcess) {
            try { ffmpegProcess.kill(); } catch (e) { console.error("[main.js] Erro ao tentar matar processo ffmpeg ao fechar:", e); }
            ffmpegProcess = null;
        }
    });
}

app.on('ready', async () => {
    console.log("[main.js] App ready.");
    const ffmpegExists = await checkFFmpeg();
    if (!ffmpegExists) {
        console.error("[main.js] FFmpeg check failed.");
        dialog.showErrorBox("Erro FFmpeg", "FFmpeg não encontrado ou não está no PATH do sistema.");
        app.quit(); return;
    }
    console.log("[main.js] FFmpeg check successful.");
    createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });

async function checkFFmpeg() {
    console.log("[main.js] checkFFmpeg called.");
    return new Promise((resolve) => {
        try {
            const ffmpeg = spawn('ffmpeg', ['-version']);
            let errored = false;
            ffmpeg.on('error', (err) => { console.error("[main.js] FFmpeg spawn error on check:", err); errored = true; resolve(false); });
            ffmpeg.stdout.on('data', (data) => console.log(`[main.js] FFmpeg version stdout: ${data.toString().substring(0,100)}...`));
            ffmpeg.on('close', (code) => { console.log("[main.js] FFmpeg version check process closed with code:", code); if (!errored) resolve(code === 0); });
        } catch (e) { console.error("[main.js] Catch block error in checkFFmpeg:", e); resolve(false); }
    });
}

function getFileSizeMb(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return parseFloat((stats.size / (1024 * 1024)).toFixed(2));
    } catch (error) {
        console.error("[main.js] Error getting file size:", filePath, error);
        return 0;
    }
}

async function getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
        try {
            const ffprobe = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
            let output = '';
            let errorOutput = '';
            ffprobe.stdout.on('data', (data) => output += data);
            ffprobe.stderr.on('data', (data) => errorOutput += data);
            ffprobe.on('error', (err) => { console.error("[main.js] ffprobe spawn error:", err); reject(new Error(`ffprobe spawn error: ${err.message}`)); });
            ffprobe.on('close', (code) => {
                if (code === 0) {
                    try { resolve(JSON.parse(output)); } catch (e) { console.error("[main.js] Error parsing ffprobe JSON output:", e, "Output:", output.substring(0, 200)); reject(new Error(`Error parsing ffprobe JSON output: ${e.message}.`)); }
                } else { console.error("[main.js] ffprobe exited with error. Code:", code, "Stderr:", errorOutput.substring(0,200)); reject(new Error(`ffprobe exited with code ${code}. Stderr: ${errorOutput}`)); }
            });
        } catch (e) { console.error("[main.js] Catch block error in getVideoInfo spawning ffprobe:", e); reject(new Error(`Error spawning ffprobe: ${e.message}`)); }
    });
}

function getVideoDuration(videoInfo) {
    if (videoInfo) {
        try {
            const videoStream = videoInfo.streams?.find(s => s.codec_type === 'video');
            if (videoStream && videoStream.duration && videoStream.duration !== 'N/A') return parseFloat(videoStream.duration);
            if (videoInfo.format && videoInfo.format.duration && videoInfo.format.duration !== 'N/A') return parseFloat(videoInfo.format.duration);
        } catch (e) { console.error("[main.js] Error parsing duration from video info:", e); return null; }
    }
    return null;
}

ipcMain.handle('get-file-size-mb', (event, filePath) => getFileSizeMb(filePath));

ipcMain.handle('get-video-info', async (event, filePath) => {
    console.log(`[main.js] IPC 'get-video-info' received for: ${filePath}`);
    try {
        const info = await getVideoInfo(filePath);
        const duration = getVideoDuration(info);
        console.log(`[main.js] Video info for ${filePath}: Duration ${duration}`);
        return { info, duration };
    } catch (error) {
        console.error("[main.js] Error in get-video-info handler:", filePath, error);
        return { info: null, duration: null, error: error.message };
    }
});

ipcMain.handle('select-input-file', async () => {
    console.log('[main.js] IPC select-input-file: mainWindow valid?', !!(mainWindow && !mainWindow.isDestroyed()));
    if (!mainWindow || mainWindow.isDestroyed()) { console.error('[main.js] selectInputFile: mainWindow is null or destroyed!'); return null; }
    try {
        const result = await dialog.showOpenDialog(mainWindow, { title: "Selecionar arquivo de vídeo", properties: ['openFile'], filters: [{ name: "Arquivos de Vídeo", extensions: ["mp4", "mkv", "avi", "mov", "flv"] }, { name: "Todos os arquivos", extensions: ["*"] }] }); // Removido webm daqui também, por consistência, embora não seja estritamente necessário
        console.log('[main.js] select-input-file dialog result:', result);
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    } catch (error) { console.error('[main.js] Error in showOpenDialog (select-input-file):', error); return null; }
});

ipcMain.handle('select-output-file', async (event, options) => {
    console.log('[main.js] IPC select-output-file: mainWindow valid?', !!(mainWindow && !mainWindow.isDestroyed()), 'Options:', options);
    if (!mainWindow || mainWindow.isDestroyed()) { console.error('[main.js] selectOutputFile: mainWindow is null or destroyed!'); return null; }
    try {
        // *** MODIFICAÇÃO: Removido WebM das opções de filtro ***
        const result = await dialog.showSaveDialog(mainWindow, { 
            title: "Salvar arquivo comprimido como...", 
            defaultPath: options.defaultPath, 
            filters: [
                { name: "Vídeo MP4", extensions: ["mp4"] }, 
                { name: "Vídeo MKV", extensions: ["mkv"] }, 
                { name: "Vídeo AVI", extensions: ["avi"] }, // AVI não é ideal para codecs modernos como AV1, mas mantido por enquanto.
                { name: "Todos os arquivos", extensions: ["*"] }
            ] 
        });
        console.log('[main.js] select-output-file dialog result:', result);
        return result.canceled ? null : result.filePath;
    } catch (error) { console.error('[main.js] Error in showSaveDialog (select-output-file):', error); return null; }
});

ipcMain.on('cancel-compression', () => {
    console.log("[main.js] IPC 'cancel-compression' received.");
    cancelCompressionFlag = true;
    if (ffmpegProcess) {
        console.log("[main.js] Attempting to kill FFmpeg process ID:", ffmpegProcess.pid);
        const killed = ffmpegProcess.kill('SIGTERM'); console.log("[main.js] FFmpeg process kill('SIGTERM') returned:", killed);
        setTimeout(() => { if (ffmpegProcess && !ffmpegProcess.killed) { console.warn("[main.js] FFmpeg process did not terminate with SIGTERM, sending SIGKILL."); ffmpegProcess.kill('SIGKILL'); } }, 1000);
    } else { console.warn("[main.js] Cancel called but no FFmpeg process was found."); }
});

ipcMain.handle('compress-video', async (event, args) => {
    const { inputPath, outputPath, codec, bitrate, useVaapi } = args;
    console.log("[main.js] IPC 'compress-video' received with args:", args);
    cancelCompressionFlag = false;
    let currentFps = "N/A";
    let currentSpeed = "N/A";
    let videoDurationForProgress = 0;

    try {
        const videoMeta = await getVideoInfo(inputPath);
        videoDurationForProgress = getVideoDuration(videoMeta) || 0;
        console.log(`[main.js] Duration for progress calculation: ${videoDurationForProgress}s`);
    } catch (err) {
        console.warn("[main.js] Could not get video duration for progress calculation:", err.message);
    }

    return new Promise((resolve, reject) => {
        const cmdArgs = [
            "-hide_banner", "-loglevel", "info",
            "-i", inputPath, "-y",
            "-progress", "pipe:1"
        ];

        const isLinux = process.platform === 'linux';
        const applyVaapi = useVaapi && isLinux;

        if (applyVaapi) {
            console.log("[main.js] Applying VA-API flags.");
            cmdArgs.push("-vaapi_device", "/dev/dri/renderD128");
            console.log(`[main.js] Using common VA-API filter 'format=nv12,hwupload' for codec: ${codec}.`);
            cmdArgs.push("-vf", "format=nv12,hwupload");
        }

        // *** MODIFICAÇÃO: Removida a opção de codec VP9 ***
        if (codec === "h264") {
            if (applyVaapi) cmdArgs.push("-c:v", "h264_vaapi");
            else cmdArgs.push("-c:v", "libx264", "-preset", "medium");
        } else if (codec === "h265") {
            if (applyVaapi) cmdArgs.push("-c:v", "hevc_vaapi");
            else cmdArgs.push("-c:v", "libx265", "-preset", "medium");
        } else if (codec === "av1") {
            if (applyVaapi) cmdArgs.push("-c:v", "av1_vaapi");
            else cmdArgs.push("-c:v", "libaom-av1", "-cpu-used", "4", "-row-mt", "1");
        } else {
            // Se um codec desconhecido (ou VP9 que foi removido) for passado
            console.error(`[main.js] Codec de vídeo não suportado: ${codec}`);
            return reject(new Error(`Codec de vídeo não suportado: ${codec}`));
        }

        cmdArgs.push(
            "-b:v", `${bitrate}k`,
            "-c:a", "aac", "-b:a", `${AUDIO_BITRATE_KBPS}k`, // Mantendo AAC para áudio
            outputPath
        );

        console.log("[main.js] Spawning FFmpeg with command: ffmpeg", ...cmdArgs.join(" ").match(/(?:[^\s"]+|"[^"]*")+/g));
        try {
            ffmpegProcess = spawn('ffmpeg', cmdArgs);
        } catch (spawnError) {
             console.error("[main.js] Error spawning FFmpeg process:", spawnError);
             return reject(new Error(`Falha ao iniciar FFmpeg: ${spawnError.message}`));
        }
        if (!ffmpegProcess || !ffmpegProcess.pid) {
            console.error("[main.js] Failed to spawn FFmpeg process or process has no PID.");
            return reject(new Error("Falha ao iniciar o processo FFmpeg (PID nulo)."));
        }
        console.log("[main.js] FFmpeg process spawned with PID:", ffmpegProcess.pid);

        const stderrRegex = /frame=\s*(?<frame>\d+)\s+fps=\s*(?<fps>\d*\.?\d*)\s+.*?time=(?<time>\d{2}:\d{2}:\d{2}\.\d{2})\s+bitrate=\s*(?<bitrate>\d*\.?\d*k?bits\/s)\s*(?:speed=\s*(?<speed>\d*\.?\d*)x)?/;
        let stderrBuffer = '';

        ffmpegProcess.stdout.on('data', (data) => {
            if (cancelCompressionFlag || !mainWindow || mainWindow.isDestroyed()) return;
            const lines = data.toString().split('\n');
            let progressData = { progress: 0, fps: currentFps, speed: currentSpeed };
            let progressUpdatedFromStdout = false;
            for (const line of lines) {
                const parts = line.trim().split('=');
                if (parts.length === 2) {
                    const key = parts[0].trim(); const value = parts[1].trim();
                    if (key === "out_time_ms" && videoDurationForProgress > 0) { try { const currentTimeSec = parseInt(value) / 1000000.0; progressData.progress = Math.min(Math.floor((currentTimeSec / videoDurationForProgress) * 100), 99); progressUpdatedFromStdout = true; } catch (e) {/* ignore */} }
                    else if (key === "fps") { try { currentFps = parseFloat(value).toFixed(1); progressData.fps = currentFps; progressUpdatedFromStdout = true; } catch (e) {/* ignore */} }
                    else if (key === "speed") { currentSpeed = value; progressData.speed = currentSpeed; progressUpdatedFromStdout = true; }
                }
            }
            if (progressUpdatedFromStdout && mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('compression-progress', progressData); }
        });
        ffmpegProcess.stderr.on('data', (data) => {
            if (cancelCompressionFlag || !mainWindow || mainWindow.isDestroyed()) return;
            const lineStr = data.toString(); stderrBuffer += lineStr;
            const lastNewLine = stderrBuffer.lastIndexOf('\n');
            const lastCarriageReturn = stderrBuffer.lastIndexOf('\r');
            const lastBreak = Math.max(lastNewLine, lastCarriageReturn);
            const relevantPortion = lastBreak > -1 ? stderrBuffer.substring(lastBreak) : stderrBuffer;

            const match = stderrRegex.exec(relevantPortion);
            let progressData = { progress: 0, fps: currentFps, speed: currentSpeed }; let progressUpdatedFromStderr = false;
            if (match && match.groups) {
                const groups = match.groups;
                if (groups.fps) { try { currentFps = parseFloat(groups.fps).toFixed(1); progressData.fps = currentFps; progressUpdatedFromStderr = true; } catch(e) {/* ignore */} }
                if (groups.speed) { currentSpeed = `${groups.speed}x`; progressData.speed = currentSpeed; progressUpdatedFromStderr = true; }
                if (videoDurationForProgress > 0 && groups.time) {
                    try {
                        const [h, m, s_ms] = groups.time.split(':'); const [s, ms_part] = s_ms.split('.');
                        const currentTimeSec = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s) + (parseFloat(ms_part) / 100.0);
                        progressData.progress = Math.min(Math.floor((currentTimeSec / videoDurationForProgress) * 100), 99); progressUpdatedFromStderr = true;
                    } catch (e) {/* ignore */}
                }
                if (progressUpdatedFromStderr && mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('compression-progress', progressData); }
            }
            if (stderrBuffer.length > 16384) { stderrBuffer = stderrBuffer.slice(stderrBuffer.length - 8192); }
        });
        ffmpegProcess.on('close', (code) => {
            console.log("[main.js] FFmpeg process exited with code:", code, "PID:", ffmpegProcess ? ffmpegProcess.pid : 'N/A (already cleared or failed)');
            const finalStderr = stderrBuffer;
            ffmpegProcess = null;
            if (cancelCompressionFlag) { console.log("[main.js] Compression was cancelled."); resolve({ success: false, cancelled: true, message: "Compressão cancelada." });
            } else if (code === 0) {
                console.log("[main.js] Compression successful.");
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('compression-progress', { progress: 100, fps: currentFps, speed: currentSpeed });
                resolve({ success: true, message: "Compressão concluída!" });
            } else {
                let errorMessage = `Erro na compressão (FFmpeg código de saída: ${code}).`;
                const errorLines = finalStderr.split('\n')
                    .map(line => line.trim())
                    .filter(line => 
                        (line.toLowerCase().includes('error') && !line.toLowerCase().includes('error resilience')) || 
                        line.toLowerCase().includes('failed') || 
                        line.toLowerCase().includes('invalid argument') ||
                        line.startsWith('[') 
                    );
                
                if (errorLines.length > 0) {
                    const detail = errorLines.slice(Math.max(0, errorLines.length - 5)).join('; ').substring(0, 500);
                    errorMessage += `\nDetalhes: ${detail}`;
                } else if (finalStderr.trim()) {
                    errorMessage += `\nFFmpeg output: ${finalStderr.substring(Math.max(0, finalStderr.length - 500)).trim()}`;
                }
                console.error("[main.js] FFmpeg failed.", errorMessage, "\nFull stderr:\n", finalStderr);
                reject(new Error(errorMessage));
            }
        });
        ffmpegProcess.on('error', (err) => {
            console.error("[main.js] FFmpeg process emitted 'error' event:", err);
            const pid = ffmpegProcess ? ffmpegProcess.pid : 'N/A (error before PID or after clear)';
            ffmpegProcess = null;
            reject(new Error(`Falha ao executar o FFmpeg (PID: ${pid}): ${err.message}`));
        });
    });
});