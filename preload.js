// preload.js (Versão Revisada e mais Robusta)
const { contextBridge, ipcRenderer } = require('electron');

console.log('[preload.js] Iniciando execução do script de preload.');

let pathModule = null;
try {
    pathModule = require('path');
    console.log('[preload.js] Módulo "path" carregado com sucesso.');
} catch (error) {
    console.error('[preload.js] ERRO ao tentar carregar o módulo "path":', error);
    // pathModule permanecerá null, e as funções de path não estarão totalmente funcionais
}

let currentPlatform = 'unknown';
try {
    currentPlatform = process.platform;
    console.log('[preload.js] process.platform acessado com sucesso:', currentPlatform);
} catch (error) {
    console.error('[preload.js] ERRO ao tentar acessar process.platform:', error);
    // currentPlatform permanecerá 'unknown'
}

const electronAPIObject = {
    // Funções de chamada IPC
    checkFFmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
    getVideoInfo: (filePath) => ipcRenderer.invoke('get-video-info', filePath),
    getFileSizeMb: (filePath) => ipcRenderer.invoke('get-file-size-mb', filePath),
    selectInputFile: () => ipcRenderer.invoke('select-input-file'),
    selectOutputFile: (options) => ipcRenderer.invoke('select-output-file', options),
    compressVideo: (args) => ipcRenderer.invoke('compress-video', args),
    cancelCompression: () => ipcRenderer.send('cancel-compression'),

    // Listener de evento para progresso da compressão
    onCompressionProgress: (callback) => {
        const listener = (_event, value) => callback(value);
        ipcRenderer.on('compression-progress', listener);
        // Retorna uma função para remover o listener
        return () => {
            ipcRenderer.removeListener('compression-progress', listener);
            console.log('[preload.js] Listener de compression-progress removido.');
        };
    },

    // Expõe a plataforma através de uma função
    getPlatform: () => currentPlatform,

    // Funções de path (só se o módulo path carregou)
    path: {
        basename: (p, ext) => pathModule ? pathModule.basename(p, ext) : '[path.basename indisponível]',
        dirname: (p) => pathModule ? pathModule.dirname(p) : '[path.dirname indisponível]',
        join: (...paths) => pathModule ? pathModule.join(...paths) : '[path.join indisponível]',
        extname: (p) => pathModule ? pathModule.extname(p) : '[path.extname indisponível]',
    }
};

if (pathModule) {
    console.log('[preload.js] Funções de "path" foram configuradas no objeto electronAPI.');
} else {
    console.warn('[preload.js] Módulo "path" não carregou. As funções de path em electronAPI podem não funcionar como esperado.');
}

try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPIObject);
    console.log('[preload.js] Objeto electronAPI EXPOSTO para a janela (window) com sucesso.');
} catch (error) {
    console.error('[preload.js] ERRO FATAL ao tentar usar contextBridge.exposeInMainWorld:', error);
}