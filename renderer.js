const AUDIO_BITRATE_KBPS = 128;

document.addEventListener('DOMContentLoaded', () => {
    console.log("[renderer.js] DOMContentLoaded");

    // Elementos da UI
    const dropArea = document.getElementById('drop-area');
    const dropInstructions = document.getElementById('drop-instructions');
    const inputFileEntry = document.getElementById('input-file');
    const selectInputBtn = document.getElementById('select-input-btn');
    const fileInfoLabel = document.getElementById('file-info-label');

    const codecSelect = document.getElementById('codec-select');
    const useVaapiCheckbox = document.getElementById('use-vaapi');
    const vaapiGroup = document.getElementById('vaapi-group');

    const bitrateModeManualBtn = document.getElementById('bitrate-mode-manual');
    const bitrateModeAutoBtn = document.getElementById('bitrate-mode-auto');
    const bitrateSlider = document.getElementById('bitrate-slider');
    const bitrateValueInput = document.getElementById('bitrate-value');
    const targetSizeInput = document.getElementById('target-size-mb');
    const estimatedSizeLabel = document.getElementById('estimated-size-label');
    const bitrateManualControls = document.querySelector('.bitrate-manual-controls');
    const bitrateAutoControls = document.querySelector('.bitrate-auto-controls');

    const outputFileEntry = document.getElementById('output-file');
    const selectOutputBtn = document.getElementById('select-output-btn');

    const progressBar = document.getElementById('progress-bar');
    const statusLabel = document.getElementById('status-label');
    const fpsLabel = document.getElementById('fps-label');
    const speedLabel = document.getElementById('speed-label');
    const compressBtn = document.getElementById('compress-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    let currentInputFile = null;
    let videoDurationSec = null;
    let autoBitrateMode = false;
    let isCompressing = false;
    let isUpdatingBitrateInternally = false; // Flag para evitar loop de eventos em bitrate

    // --- Inicialização ---
    // Utiliza a nova função getPlatform() exposta pelo preload.js revisado
    const platform = window.electronAPI.getPlatform();
    console.log("[renderer.js] Initializing. Platform reported by preload:", platform);

    if (platform === 'linux') {
        vaapiGroup.style.display = 'flex'; // CSS de .form-group é display: flex
        console.log("[renderer.js] VA-API checkbox group should be visible (display: flex).");
    } else {
        useVaapiCheckbox.checked = false;
        useVaapiCheckbox.disabled = true;
        vaapiGroup.style.display = 'none';
        console.log("[renderer.js] VA-API checkbox group hidden (not Linux).");
    }

    updateBitrateModeUI();

    // --- Drag and Drop ---
    dropArea.addEventListener('click', (e) => {
        e.preventDefault();
        console.log("[renderer.js] Drop area clicked, triggering selectInputBtn click.");
        selectInputBtn.click();
    });

    dropArea.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropArea.classList.add('dragover');
    });

    dropArea.addEventListener('dragleave', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropArea.classList.remove('dragover');
    });

    dropArea.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropArea.classList.remove('dragover');
        console.log('[renderer.js] Drop event detected.');

        const dt = event.dataTransfer;
        console.log('[renderer.js] dataTransfer types:', dt.types);
        if (dt.types) {
            for (const type of dt.types) {
                try {
                    console.log(`  Type: ${type}, Data: ${dt.getData(type)}`);
                } catch (e) {
                    console.warn(`  Could not getData for type: ${type}`, e.message);
                }
            }
        }

        console.log('[renderer.js] dataTransfer.items:', dt.items);
        let processedFileFromItems = false;
        if (dt.items && dt.items.length > 0) {
            for (let i = 0; i < dt.items.length; i++) {
                const item = dt.items[i];
                console.log(`  Item ${i} - kind: ${item.kind}, type: ${item.type}`);
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    console.log(`  File from item.getAsFile() (item ${i}):`, file);
                    if (file) {
                        console.log(`    File name: ${file.name}, size: ${file.size}, type: ${file.type}, lastModified: ${file.lastModified}`);
                        if (file.path) {
                            console.log('    SUCCESS: Got file path from item.getAsFile():', file.path);
                            processSelectedFile(file.path);
                            processedFileFromItems = true;
                            break;
                        } else {
                            console.warn('    WARNING: File from item.getAsFile() does NOT have a .path property.');
                        }
                    } else {
                         console.warn(`    WARNING: item.getAsFile() (item ${i}) returned null.`);
                    }
                }
            }
        }

        if (processedFileFromItems) return;

        console.log('[renderer.js] Attempting fallback to dataTransfer.files');
        const files = dt.files;
        console.log('[renderer.js] Drop event files (FileList):', files, `Length: ${files ? files.length : 'N/A'}`);
        if (files && files.length > 0) {
            const filePath = files[0].path;
            console.log('[renderer.js] Dropped file path (from FileList[0].path):', filePath);
            if (filePath) {
                processSelectedFile(filePath);
            } else {
                console.warn('[renderer.js] FileList[0].path is undefined/empty. File name:', files[0].name);
                alert("Não foi possível obter o caminho do arquivo arrastado (FileList). Tente selecionar manualmente.");
            }
        } else {
            console.warn('[renderer.js] No files found in drop event dataTransfer.files or processed from items.');
            if (!dt.items || dt.items.length === 0) {
                 alert("Nenhum arquivo detectado no evento de drop. Verifique as permissões ou a forma como o arquivo foi arrastado.");
            }
        }
    });

    // --- Seleção de Arquivos ---
    selectInputBtn.addEventListener('click', async () => {
        console.log('[renderer.js] selectInputBtn DOM click event triggered.');
        statusLabel.textContent = "Abrindo seletor de arquivo...";
        try {
            // Verifica se a função existe antes de chamar
            if (typeof window.electronAPI.selectInputFile !== 'function') {
                console.error('[renderer.js] window.electronAPI.selectInputFile não é uma função! O preload falhou?');
                alert("Erro interno: A função para selecionar arquivo não está disponível. O script de preload pode ter falhado.");
                statusLabel.textContent = "Erro interno.";
                return;
            }
            const filePath = await window.electronAPI.selectInputFile();
            console.log('[renderer.js] window.electronAPI.selectInputFile returned:', filePath);
            if (filePath) {
                processSelectedFile(filePath);
            } else {
                statusLabel.textContent = "Seleção de arquivo cancelada ou falhou.";
                console.log('[renderer.js] File selection was cancelled or failed (no path returned).');
            }
        } catch (error) {
            statusLabel.textContent = "Erro ao abrir seletor de arquivo.";
            console.error('[renderer.js] Error calling window.electronAPI.selectInputFile:', error);
            alert(`Erro ao tentar abrir o seletor de arquivos: ${error.message}`);
        }
    });

    selectOutputBtn.addEventListener('click', async () => {
        console.log('[renderer.js] selectOutputBtn DOM click event triggered.');
        if (typeof window.electronAPI.selectOutputFile !== 'function' || typeof window.electronAPI.path.basename !== 'function') {
            console.error('[renderer.js] Funções essenciais de electronAPI (selectOutputFile ou path) não estão disponíveis! O preload falhou?');
            alert("Erro interno: Funções para salvar arquivo não estão disponíveis. O script de preload pode ter falhado.");
            return;
        }

        const currentOutputValue = outputFileEntry.value;
        const inputPathForDefaults = currentInputFile || "video_comprimido";

        const defaultFileName = currentOutputValue ? window.electronAPI.path.basename(currentOutputValue) : window.electronAPI.path.basename(generateOutputFilename(inputPathForDefaults, codecSelect.value));
        const defaultDir = currentOutputValue ? window.electronAPI.path.dirname(currentOutputValue) : (currentInputFile ? window.electronAPI.path.dirname(currentInputFile) : '');
        
        let defaultFullPath = window.electronAPI.path.join(defaultDir, defaultFileName);
        const selCodec = codecSelect.value;
        let expectedExt = ".mp4";
        if (selCodec === "vp9") {
            expectedExt = ".webm";
        } else if (selCodec === "h264" || selCodec === "h265" || selCodec === "av1") {
            const currentInputExt = currentInputFile ? window.electronAPI.path.extname(inputPathForDefaults).toLowerCase() : ".mp4";
            if ((selCodec === "h264" || selCodec === "h265") && currentInputExt === ".mkv") {
            expectedExt = ".mkv";
            } else {
            expectedExt = ".mp4";
            }
        }

        if (window.electronAPI.path.extname(defaultFullPath).toLowerCase() !== expectedExt) {
            defaultFullPath = defaultFullPath.substring(0, defaultFullPath.lastIndexOf('.') > -1 ? defaultFullPath.lastIndexOf('.') : defaultFullPath.length) + expectedExt;
        }
        
        console.log(`[renderer.js] Attempting to open save dialog with defaultPath: ${defaultFullPath}`);
        statusLabel.textContent = "Abrindo seletor de arquivo de saída...";
        try {
            const filePath = await window.electronAPI.selectOutputFile({ defaultPath: defaultFullPath });
            console.log('[renderer.js] window.electronAPI.selectOutputFile returned:', filePath);
            if (filePath) {
                outputFileEntry.value = filePath;
                statusLabel.textContent = "Pronto.";
            } else {
                statusLabel.textContent = "Seleção de arquivo de saída cancelada ou falhou.";
                console.log('[renderer.js] Output file selection was cancelled or failed (no path returned).');
            }
        } catch (error) {
            statusLabel.textContent = "Erro ao abrir seletor de arquivo de saída.";
            console.error('[renderer.js] Error calling window.electronAPI.selectOutputFile:', error);
            alert(`Erro ao tentar abrir o seletor de arquivos de saída: ${error.message}`);
        }
    });

    async function processSelectedFile(filePath) {
        console.log("[renderer.js] processSelectedFile called with:", filePath);
        if (typeof window.electronAPI.getVideoInfo !== 'function' || typeof window.electronAPI.getFileSizeMb !== 'function') {
            console.error('[renderer.js] Funções getVideoInfo ou getFileSizeMb não disponíveis! O preload falhou?');
            fileInfoLabel.textContent = "Erro interno: Funções de informação do vídeo indisponíveis.";
            return;
        }

        currentInputFile = filePath;
        inputFileEntry.value = filePath;
        dropInstructions.textContent = window.electronAPI.path.basename(filePath);
        
        fileInfoLabel.textContent = "Obtendo informações do vídeo...";
        const videoData = await window.electronAPI.getVideoInfo(filePath);
        
        if (videoData && videoData.info && !videoData.error) {
            videoDurationSec = videoData.duration;
            console.log("[renderer.js] Video duration:", videoDurationSec);
            const fileSizeMb = await window.electronAPI.getFileSizeMb(filePath);
            let fileInfoText = `Original: ${fileSizeMb !== undefined ? fileSizeMb.toFixed(2) : 'N/A'} MB`;
            const videoStream = videoData.info.streams?.find(s => s.codec_type === 'video');
            if (videoStream) {
                const width = videoStream.width || 'N/A';
                const height = videoStream.height || 'N/A';
                const codecName = (videoStream.codec_name || 'N/A').toUpperCase();
                fileInfoText += ` | ${width}x${height} | ${codecName}`;
            }
            fileInfoLabel.textContent = fileInfoText;
        } else {
            const errorMessage = videoData && videoData.error ? videoData.error : 'Detalhes desconhecidos';
            fileInfoLabel.textContent = `Erro ao ler informações: ${errorMessage}.`;
            console.error("[renderer.js] Error getting video info from main:", errorMessage);
            videoDurationSec = null;
        }
        
        updateOutputFilenameOnInputChange();
        updateEstimatedSize();
        if (autoBitrateMode) {
            calculateAndSetBitrate();
        }
        statusLabel.textContent = `Pronto para comprimir: ${window.electronAPI.path.basename(filePath)}`;
        progressBar.value = 0;
        fpsLabel.textContent = "FPS: N/A";
        speedLabel.textContent = "Velocidade: N/A";
    }
    
    function generateOutputFilename(inputPath, codec) {
        if (!inputPath) return "sem_nome_definido";
        if (typeof window.electronAPI.path.dirname !== 'function') {
             console.warn('[renderer.js] window.electronAPI.path.dirname não é uma função. Usando fallback.');
             return "saida_video" + (codec === "vp9" ? ".webm" : ".mp4");
        }

        const dirname = window.electronAPI.path.dirname(inputPath);
        const ext = window.electronAPI.path.extname(inputPath);
        const stem = window.electronAPI.path.basename(inputPath, ext);
        
        let outputExt = ext;
        if (codec === "vp9") {
            outputExt = ".webm";
        } else if (codec === "av1" || codec === "h264" || codec === "h265") {
            if ((codec === "h264" || codec === "h265") && ext.toLowerCase() === ".mkv") {
                outputExt = ".mkv";
            } else {
                outputExt = ".mp4";
            }
        }
        return window.electronAPI.path.join(dirname, `${stem}_encoded_${codec}${outputExt}`);
    }

    function updateOutputFilenameOnInputChange() {
        if (currentInputFile) {
            outputFileEntry.value = generateOutputFilename(currentInputFile, codecSelect.value);
            console.log("[renderer.js] Output filename updated to:", outputFileEntry.value);
        }
    }
    codecSelect.addEventListener('change', () => {
        console.log("[renderer.js] Codec changed to:", codecSelect.value);
        updateOutputFilenameOnInputChange();
        if (autoBitrateMode) calculateAndSetBitrate(); else updateEstimatedSize();
    });

    // --- Lógica de Bitrate ---
    bitrateModeManualBtn.addEventListener('click', () => {
        if (isCompressing) return;
        autoBitrateMode = false;
        console.log("[renderer.js] Bitrate mode set to Manual.");
        updateBitrateModeUI();
    });
    bitrateModeAutoBtn.addEventListener('click', () => {
        if (isCompressing) return;
        autoBitrateMode = true;
        console.log("[renderer.js] Bitrate mode set to Auto.");
        updateBitrateModeUI();
    });

    function updateBitrateModeUI() {
        if (autoBitrateMode) {
            bitrateModeManualBtn.classList.remove('active');
            bitrateModeAutoBtn.classList.add('active');
            bitrateManualControls.style.display = 'none';
            bitrateAutoControls.style.display = 'flex';
            calculateAndSetBitrate();
        } else {
            bitrateModeManualBtn.classList.add('active');
            bitrateModeAutoBtn.classList.remove('active');
            bitrateManualControls.style.display = 'flex';
            bitrateAutoControls.style.display = 'none';
            updateEstimatedSize(); 
        }
    }

    bitrateSlider.addEventListener('input', () => {
        if (!autoBitrateMode) {
            bitrateValueInput.value = bitrateSlider.value;
            updateEstimatedSize();
        }
    });

    bitrateValueInput.addEventListener('input', () => {
        if (isUpdatingBitrateInternally || autoBitrateMode) return;
        let value = parseInt(bitrateValueInput.value);
        const sliderMin = parseInt(bitrateSlider.min);
        const sliderMax = parseInt(bitrateSlider.max);
        
        if (!isNaN(value)) {
             bitrateSlider.value = Math.max(sliderMin, Math.min(sliderMax, value));
        }
        updateEstimatedSize();
    });

    bitrateValueInput.addEventListener('change', () => {
        if (isUpdatingBitrateInternally || autoBitrateMode) return;
        let value = parseInt(bitrateValueInput.value);
        const minVal = 100;
        const maxVal = 50000;
        if (isNaN(value) || value < minVal) value = minVal;
        if (value > maxVal) value = maxVal;
        
        isUpdatingBitrateInternally = true;
        bitrateValueInput.value = value;
        const sliderMin = parseInt(bitrateSlider.min);
        const sliderMax = parseInt(bitrateSlider.max);
        bitrateSlider.value = Math.max(sliderMin, Math.min(sliderMax, value));
        isUpdatingBitrateInternally = false;
        updateEstimatedSize();
    });

    targetSizeInput.addEventListener('input', () => {
        if (autoBitrateMode) {
            calculateAndSetBitrate();
        }
    });

    function calculateEstimatedSize(videoBitrateKbps) {
        if (videoDurationSec && videoBitrateKbps > 0) {
            const videoSizeBytes = (videoBitrateKbps * 1000 / 8) * videoDurationSec;
            const audioSizeBytes = (AUDIO_BITRATE_KBPS * 1000 / 8) * videoDurationSec;
            const totalSizeMb = (videoSizeBytes + audioSizeBytes) / (1024 * 1024);
            return totalSizeMb;
        }
        return null;
    }

    function updateEstimatedSize() {
        if (!videoDurationSec) {
            estimatedSizeLabel.textContent = "Estimado: N/A (sem duração)";
            return;
        }
        try {
            const currentBitrateKbps = parseFloat(bitrateValueInput.value);
            if (isNaN(currentBitrateKbps) || currentBitrateKbps <= 0) {
                 estimatedSizeLabel.textContent = "Estimado: N/A (bitrate inválido)";
                 return;
            }
            const estimatedMb = calculateEstimatedSize(currentBitrateKbps);
            if (estimatedMb !== null) {
                estimatedSizeLabel.textContent = `Estimado: ${estimatedMb.toFixed(2)} MB`;
            } else {
                estimatedSizeLabel.textContent = "Estimado: N/A";
            }
        } catch (e) {
            estimatedSizeLabel.textContent = "Estimado: N/A (erro)";
            console.error("[renderer.js] Error updating estimated size:", e);
        }
    }
    
    function calculateAndSetBitrate() {
        if (!videoDurationSec || !autoBitrateMode) {
            updateEstimatedSize();
            return;
        }
        console.log("[renderer.js] Calculating auto bitrate...");
        try {
            const targetTotalMb = parseFloat(targetSizeInput.value);
            if (isNaN(targetTotalMb) || targetTotalMb <= 0) {
                estimatedSizeLabel.textContent = "Estimado: N/A (tamanho alvo inválido)";
                return;
            }

            const audioContributionMb = (AUDIO_BITRATE_KBPS * 1000 / 8 * videoDurationSec) / (1024 * 1024);
            let targetVideoMb = targetTotalMb - audioContributionMb;
            let calculatedVideoBitrateKbps;

            if (targetVideoMb <= 0.01) {
                calculatedVideoBitrateKbps = 100;
                console.warn("[renderer.js] Target size too small for audio, setting video bitrate to minimum (100kbps).");
            } else {
                calculatedVideoBitrateKbps = (targetVideoMb * 1024 * 1024 * 8 / 1000) / videoDurationSec;
            }
            
            const clampedBitrate = Math.max(100, Math.min(50000, Math.round(calculatedVideoBitrateKbps)));
            console.log(`[renderer.js] Auto bitrate calculated: ${clampedBitrate}kbps (target: ${targetTotalMb}MB, duration: ${videoDurationSec}s)`);
            
            isUpdatingBitrateInternally = true;
            bitrateValueInput.value = clampedBitrate;
            const sliderMin = parseInt(bitrateSlider.min);
            const sliderMax = parseInt(bitrateSlider.max);
            bitrateSlider.value = Math.max(sliderMin, Math.min(sliderMax, clampedBitrate));
            isUpdatingBitrateInternally = false;
            
            updateEstimatedSize();

        } catch (e) {
            estimatedSizeLabel.textContent = "Estimado: N/A (erro no cálculo)";
            console.error("[renderer.js] Error calculating and setting bitrate:", e);
        }
    }


    // --- Compressão ---
    compressBtn.addEventListener('click', async () => {
        if (isCompressing) return;
        console.log("[renderer.js] Compress button clicked.");

        if (typeof window.electronAPI.compressVideo !== 'function') {
            console.error('[renderer.js] window.electronAPI.compressVideo não é uma função! O preload falhou?');
            alert("Erro interno: A função para compressão não está disponível. O script de preload pode ter falhado.");
            return;
        }

        const inputP = inputFileEntry.value;
        const outputP = outputFileEntry.value;

        if (!inputP) {
            alert("Arquivo de entrada inválido ou não selecionado.");
            return;
        }
        if (!outputP) {
            alert("Caminho do arquivo de saída não especificado.");
            return;
        }
        if (inputP === outputP) { 
            alert("O arquivo de entrada e saída não podem ser o mesmo.");
            return;
        }
        
        let bitrate;
        try {
            bitrate = parseInt(bitrateValueInput.value);
            if (isNaN(bitrate) || bitrate < 100 || bitrate > 50000) {
                throw new Error("Bitrate fora do intervalo aceitável (100-50000 kbps).");
            }
        } catch (e) {
            alert(e.message);
            return;
        }

        isCompressing = true;
        compressBtn.disabled = true;
        cancelBtn.disabled = false;
        [selectInputBtn, selectOutputBtn, codecSelect, useVaapiCheckbox, bitrateModeManualBtn, bitrateModeAutoBtn, bitrateSlider, bitrateValueInput, targetSizeInput].forEach(el => el.disabled = true);

        statusLabel.textContent = "Iniciando compressão...";
        progressBar.value = 0;
        fpsLabel.textContent = "FPS: N/A";
        speedLabel.textContent = "Velocidade: N/A";

        try {
            const result = await window.electronAPI.compressVideo({
                inputPath: inputP,
                outputPath: outputP,
                codec: codecSelect.value,
                bitrate: bitrate,
                useVaapi: useVaapiCheckbox.checked
            });
            
            console.log("[renderer.js] Compression result from main:", result);
            if (result.success) {
                progressBar.value = 100;
                statusLabel.textContent = "Compressão Concluída!";
                const originalSizeMb = await window.electronAPI.getFileSizeMb(inputP);
                const compressedSizeMb = await window.electronAPI.getFileSizeMb(outputP);
                let reductionPercent = 0;
                if (originalSizeMb > 0 && compressedSizeMb > 0 && compressedSizeMb < originalSizeMb) {
                    reductionPercent = ((originalSizeMb - compressedSizeMb) / originalSizeMb) * 100;
                }
                alert(`Compressão bem-sucedida!\n\nOriginal: ${originalSizeMb.toFixed(2)} MB\nComprimido: ${compressedSizeMb.toFixed(2)} MB\nRedução: ${reductionPercent.toFixed(1)}%`);
            } else if (result.cancelled) {
                 statusLabel.textContent = "Compressão Cancelada.";
                 progressBar.value = 0;
                 fpsLabel.textContent = "FPS: N/A";
                 speedLabel.textContent = "Velocidade: N/A";
            } else {
                 statusLabel.textContent = `Erro: ${result.message || 'Falha desconhecida.'}`;
                 progressBar.value = 0;
                 alert(`Falha na compressão: ${result.message || 'Verifique os logs para detalhes.'}`);
            }
            
        } catch (error) { 
            progressBar.value = 0;
            statusLabel.textContent = "Erro na Compressão.";
            fpsLabel.textContent = "FPS: N/A";
            speedLabel.textContent = "Velocidade: N/A";
            alert(`Erro de Compressão:\n${error.message}`);
            console.error("[renderer.js] Compression promise rejected:", error);
        } finally {
            isCompressing = false;
            compressBtn.disabled = false;
            cancelBtn.disabled = true;
            [selectInputBtn, selectOutputBtn, codecSelect, useVaapiCheckbox, bitrateModeManualBtn, bitrateModeAutoBtn, bitrateSlider, bitrateValueInput, targetSizeInput].forEach(el => el.disabled = false);
            if (window.electronAPI.getPlatform() !== 'linux') { // Re-verifica com a função
                useVaapiCheckbox.disabled = true;
            }
        }
    });

    cancelBtn.addEventListener('click', () => {
        if (isCompressing) {
            console.log("[renderer.js] Cancel button clicked.");
            if (typeof window.electronAPI.cancelCompression !== 'function') {
                console.error('[renderer.js] window.electronAPI.cancelCompression não é uma função! O preload falhou?');
                alert("Erro interno: A função para cancelar não está disponível.");
                return;
            }
            statusLabel.textContent = "Cancelando compressão...";
            window.electronAPI.cancelCompression();
        }
    });

    // Verifica se onCompressionProgress existe antes de tentar usá-lo
    if (typeof window.electronAPI.onCompressionProgress === 'function') {
        window.electronAPI.onCompressionProgress(data => {
            if (!isCompressing) return;
            
            progressBar.value = data.progress || progressBar.value;
            statusLabel.textContent = `Comprimindo... ${Math.floor(progressBar.value)}%`;
            if (data.fps) fpsLabel.textContent = `FPS: ${data.fps}`;
            if (data.speed) speedLabel.textContent = `Velocidade: ${data.speed}`;
        });
    } else {
        console.error('[renderer.js] window.electronAPI.onCompressionProgress não é uma função! O preload pode ter falhado em expor todas as APIs.');
    }
});