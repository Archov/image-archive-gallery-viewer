// Image Gallery Manager - Core Functionality
class ImageGallery {
    constructor() {
        this.images = [];
        this.currentIndex = 0;
        this.isFullscreen = false;
        this.debugLogs = [];
        this.blobUrls = [];
        this.fullscreenWheelHandler = null;

        this.initializeElements();
        this.bindEvents();
        this.setupDragAndDrop();

        // Override console methods to capture logs
        this.setupDebugCapture();

        console.log('🔍 DEBUG: Gallery initialized with debug logging');
        console.log('🔍 DEBUG: Press Ctrl+D to export full debug logs to file');
    }

    setupDebugCapture() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            this.debugLogs.push(`[LOG ${new Date().toISOString()}] ${message}`);
            originalLog.apply(console, args);
        };

        console.error = (...args) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            this.debugLogs.push(`[ERROR ${new Date().toISOString()}] ${message}`);
            originalError.apply(console, args);
        };

        console.warn = (...args) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            this.debugLogs.push(`[WARN ${new Date().toISOString()}] ${message}`);
            originalWarn.apply(console, args);
        };
    }

    async exportDebugLogs() {
        let mainLogPath = '';
        try {
            mainLogPath = await window.electronAPI.getDebugLogPath();
        } catch (e) {
            console.warn('⚠️ Could not get main process log path:', e);
        }

        const fullLogs = [
            '=== GALLERY DEBUG LOGS ===',
            `Generated: ${new Date().toISOString()}`,
            `Platform: ${window.electronAPI.platform}`,
            `Total images: ${this.images.length}`,
            `Memory usage: ${performance.memory ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB` : 'N/A'}`,
            '',
            '=== MAIN PROCESS LOG PATH ===',
            mainLogPath || 'Not available',
            '',
            '=== RENDERER PROCESS LOGS ===',
            ...this.debugLogs
        ];

        // Try File System Access API first (modern browsers)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: `gallery-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`,
                    types: [{
                        description: 'Text Files',
                        accept: { 'text/plain': ['.txt'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(fullLogs.join('\n'));
                await writable.close();
                console.log('📄 Debug logs exported via File System Access API');
                return;
            } catch (err) {
                // User cancelled or API not supported, fall back to blob download
                if (err.name !== 'AbortError') {
                    console.warn('⚠️ File System Access API failed, falling back to download:', err);
                } else {
                    return; // User cancelled
                }
            }
        }

        // Fallback to blob download for older browsers
        const blob = new Blob([fullLogs.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gallery-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('📄 Debug logs exported to Downloads folder (fallback method)');
        if (mainLogPath) {
            console.log(`🔍 DEBUG: Main process logs available at: ${mainLogPath}`);
        }
    }

    initializeElements() {
        // Main containers
        this.dropZone = document.getElementById('drop-zone');
        this.galleryGrid = document.getElementById('gallery-grid');
        this.fullscreenOverlay = document.getElementById('fullscreen-overlay');
        this.loadingIndicator = document.getElementById('loading-indicator');

        // Buttons and controls
        this.fileSelectBtn = document.getElementById('file-select-btn');
        this.closeFullscreenBtn = document.getElementById('close-fullscreen');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');

        // Image elements
        this.fullscreenImage = document.getElementById('fullscreen-image');

        // Loading elements
        this.loadingText = document.getElementById('loading-text');
        this.loadingProgress = document.getElementById('loading-progress');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');

        // Verify critical elements exist
        if (!this.dropZone || !this.galleryGrid || !this.fileSelectBtn || !this.fullscreenOverlay || !this.fullscreenImage) {
            console.error('Critical UI elements not found!');
        }
    }

    bindEvents() {
        if (!this.fileSelectBtn || !this.closeFullscreenBtn || !this.prevBtn || !this.nextBtn || !this.fullscreenImage) {
            console.warn('⚠️ Skipping event binding: required elements missing');
            return;
        }

        // File selection
        this.fileSelectBtn.addEventListener('click', () => this.selectFiles());

        // Fullscreen controls
        this.closeFullscreenBtn.addEventListener('click', () => this.closeFullscreen());
        this.prevBtn.addEventListener('click', () => this.showPrevious());
        this.nextBtn.addEventListener('click', () => this.showNext());

        // Keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Fullscreen image click to close
        this.fullscreenImage.addEventListener('click', () => this.closeFullscreen());
    }

    setupDragAndDrop() {
        const galleryContainer = document.getElementById('gallery-container');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            galleryContainer.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        galleryContainer.addEventListener('dragenter', (e) => {
            this.dropZone.classList.add('drag-over');
        });

        galleryContainer.addEventListener('dragleave', (e) => {
            // Only remove class if we're actually leaving the drop zone
            if (!galleryContainer.contains(e.relatedTarget)) {
                this.dropZone.classList.remove('drag-over');
            }
        });

        galleryContainer.addEventListener('drop', (e) => {
            this.dropZone.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            this.loadFiles(files);
        });

        // No hover effects to optimize
    }


    async selectFiles() {
        try {
            const filePaths = await window.electronAPI.selectFiles();
            if (filePaths && filePaths.length > 0) {
                await this.loadFilesFromPaths(filePaths);
            }
        } catch (error) {
            console.error('Error selecting files:', error);
            alert('Error selecting files: ' + error.message);
        }
    }

    async loadFiles(files) {
        console.log('🔍 DEBUG: loadFiles called with', files.length, 'files');

        // Clean up previous blob URLs to prevent memory leaks
        this.cleanupBlobUrls();

        const imageFiles = files.filter(file => this.isImageFile(file));
        console.log('🔍 DEBUG: Filtered to', imageFiles.length, 'image files');

        if (imageFiles.length === 0) {
            console.log('🔍 DEBUG: No image files found');
            alert('No valid image files selected.');
            return;
        }

        console.log(`🚀 Starting to load ${imageFiles.length} files...`);
        console.log('🔍 DEBUG: Memory before loading:', performance.memory ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB` : 'N/A');
        const startTime = performance.now();

        this.showLoading();
        this.updateProgress(0, imageFiles.length);
        this.images = [];

        try {
            // Adaptive batch size based on file count and estimated memory
            const batchSize = imageFiles.length < 10 ? 2 :
                              imageFiles.length < 50 ? 3 :
                              imageFiles.length < 100 ? 4 : 5;
            let processedCount = 0;

            console.log(`🔍 DEBUG: Processing in batches of ${batchSize}...`);

            for (let i = 0; i < imageFiles.length; i += batchSize) {
                const batch = imageFiles.slice(i, i + batchSize);
                console.log(`🔍 DEBUG: Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(imageFiles.length/batchSize)} (${batch.length} files)`);

                const batchPromises = batch.map(file => this.processImageFile(file));
                const batchResults = await Promise.allSettled(batchPromises);

                // Process settled results: collect all results (including errors for display), log rejections
                const allResults = [];
                let batchSuccessfulCount = 0;

                batchResults.forEach((settled, idx) => {
                    if (settled.status === 'fulfilled') {
                        const result = settled.value;
                        if (result) {
                            allResults.push(result);
                            if (!result.error) {
                                batchSuccessfulCount++;
                            }
                        }
                        return;
                    }

                    const source = batch[idx];
                    console.error('❌ Promise rejected:', settled.reason);
                    allResults.push({
                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        name: source?.name || source?.path || 'Unknown',
                        path: source?.path,
                        error: true,
                        dataUrl: null
                    });
                });

                this.images.push(...allResults);

                processedCount += batch.length;
                this.updateProgress(processedCount, imageFiles.length);

                const successSoFar = this.images.filter(img => !img.error).length;
                console.log(`🔍 DEBUG: Batch complete. Total processed: ${processedCount}/${imageFiles.length}, successful: ${successSoFar}, batch success: ${batchSuccessfulCount}/${batch.length}`);
            }

            const failedCount = this.images.filter(img => img.error).length;
            const loadTime = performance.now() - startTime;

            console.log(`✅ Loaded ${this.images.length - failedCount} images successfully (${failedCount} failed) in ${loadTime.toFixed(2)}ms`);
            console.log('🔍 DEBUG: Memory after loading:', performance.memory ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB` : 'N/A');
            console.log(`📊 Average time per image: ${(loadTime / imageFiles.length).toFixed(2)}ms`);

            console.log('🔍 DEBUG: Rendering gallery...');
            this.renderGallery();
            console.log('🔍 DEBUG: Hiding drop zone...');
            this.hideDropZone();
            console.log('✅ Gallery load complete!');
        } catch (error) {
            console.error('❌ Error loading files:', error);
            alert('Error loading images: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    async loadFilesFromPaths(filePaths) {
        console.log('🔍 DEBUG: loadFilesFromPaths called with', filePaths.length, 'paths');

        // Clean up previous blob URLs to prevent memory leaks
        this.cleanupBlobUrls();

        console.log(`🚀 Starting to load ${filePaths.length} files from paths...`);
        console.log('🔍 DEBUG: Memory before loading:', performance.memory ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB` : 'N/A');
        const startTime = performance.now();
        const prevImagesLength = this.images.length;

        this.showLoading();
        this.updateProgress(0, filePaths.length);
        this.images = [];

        try {
            // Adaptive batch size based on file count and estimated memory
            const batchSize = filePaths.length < 10 ? 2 :
                              filePaths.length < 50 ? 3 :
                              filePaths.length < 100 ? 4 : 5;
            let processedCount = 0;

            console.log(`🔍 DEBUG: Processing file paths in batches of ${batchSize}...`);

            for (let i = 0; i < filePaths.length; i += batchSize) {
                const batch = filePaths.slice(i, i + batchSize);
                console.log(`🔍 DEBUG: Processing path batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(filePaths.length/batchSize)} (${batch.length} files)`);

                const batchPromises = batch.map(filePath => this.processImageFileFromPath(filePath));
                const batchResults = await Promise.allSettled(batchPromises);

                // Process settled results: collect all results (including errors for display), log rejections
                const allResults = [];
                let batchSuccessfulCount = 0;

                batchResults.forEach((settled, idx) => {
                    if (settled.status === 'fulfilled') {
                        const result = settled.value;
                        if (result) {
                            allResults.push(result);
                            if (!result.error) {
                                batchSuccessfulCount++;
                            }
                        }
                        return;
                    }

                    const source = batch[idx];
                    console.error('❌ Promise rejected:', settled.reason);
                    allResults.push({
                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        name: source?.name || source?.path || 'Unknown',
                        path: source?.path,
                        error: true,
                        dataUrl: null
                    });
                });

                this.images.push(...allResults);

                processedCount += batch.length;
                this.updateProgress(processedCount, filePaths.length);

                const successSoFar = this.images.filter(img => !img.error).length;
                console.log(`🔍 DEBUG: Path batch complete. Total processed: ${processedCount}/${filePaths.length}, successful: ${successSoFar}, batch success: ${batchSuccessfulCount}/${batch.length}`);
            }

            const newlyAdded = this.images.length - prevImagesLength;
            const failedCount = this.images.filter(img => img.error).length;
            const loadTime = performance.now() - startTime;

            console.log(`✅ Loaded ${newlyAdded - failedCount} images from paths successfully (${failedCount} failed) in ${loadTime.toFixed(2)}ms`);
            console.log('🔍 DEBUG: Memory after loading:', performance.memory ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB` : 'N/A');
            console.log(`📊 Average time per image: ${(loadTime / filePaths.length).toFixed(2)}ms`);

            console.log('🔍 DEBUG: Rendering gallery...');
            this.renderGallery();
            console.log('🔍 DEBUG: Hiding drop zone...');
            this.hideDropZone();
            console.log('✅ Gallery load from paths complete!');
        } catch (error) {
            console.error('❌ Error loading files from paths:', error);
            alert('Error loading images: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    async processImageFile(file) {
        const startTime = performance.now();
        console.log(`📁 Processing dragged file ${file.name}...`);

        // For Electron, we can use the file path directly instead of FileReader
        // This avoids the slow base64 encoding of large files
        if (file.path) {
            // Direct file path available (usually on desktop)
            return new Promise((resolve, reject) => {
                const img = new Image();

                const fileUrl = window.electronAPI.toFileUrl(file.path);

                img.onload = () => {
                    const processTime = performance.now() - startTime;
                    console.log(`✅ Processed ${file.name} in ${processTime.toFixed(2)}ms`);
                    resolve({
                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        name: file.name,
                        path: file.path,
                        dataUrl: fileUrl,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        aspectRatio: img.naturalWidth / img.naturalHeight,
                        file: file
                    });
                };
                img.onerror = () => {
                    console.log(`❌ Failed to load dragged image ${file.name}, falling back to FileReader`);
                    // Fallback to FileReader if file:// URL fails
                    this.fallbackProcessImageFile(file, startTime).then(resolve).catch(reject);
                };
                // Don't set crossOrigin for file:// URLs
                img.src = fileUrl;
            });
        } else {
            // Fallback for cases where file.path is not available
            return this.fallbackProcessImageFile(file, startTime);
        }
    }

    async fallbackProcessImageFile(file, startTime) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const processTime = performance.now() - startTime;
                    console.log(`✅ Fallback processed ${file.name} in ${processTime.toFixed(2)}ms`);
                    resolve({
                        id: Date.now() + Math.random(),
                        name: file.name,
                        path: file.path || file.name,
                        dataUrl: e.target.result,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        aspectRatio: img.naturalWidth / img.naturalHeight,
                        file: file
                    });
                };
                img.onerror = () => {
                    console.log(`❌ Failed to load dragged image ${file.name}`);
                    resolve({
                        id: Date.now() + Math.random(),
                        name: file.name,
                        path: file.path || file.name,
                        error: true,
                        dataUrl: null
                    });
                };
                img.src = e.target.result;
            };

            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader.readAsDataURL(file);
        });
    }

    async processImageFileFromPath(filePath) {
        const startTime = performance.now();
        try {
            const fileUrl = window.electronAPI.toFileUrl(filePath);

            const stats = await window.electronAPI.getFileStats(filePath);

            console.log(`Processing ${filePath.split(/[/\\]/).pop()}...`);

            return new Promise((resolve, reject) => {
                const img = new Image();

                img.onload = () => {
                    const processTime = performance.now() - startTime;
                    console.log(`✅ Loaded ${filePath.split(/[/\\]/).pop()} in ${processTime.toFixed(2)}ms`);
                    resolve({
                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        name: filePath.split(/[/\\]/).pop(),
                        path: filePath,
                        dataUrl: fileUrl,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        aspectRatio: img.naturalWidth / img.naturalHeight,
                        size: stats.size,
                        mtimeMs: stats.mtimeMs,
                        mtimeISO: stats.mtimeISO
                    });
                };

                img.onerror = () => {
                    console.log(`❌ File URL failed for ${filePath.split(/[/\\]/).pop()}, trying blob fallback...`);
                    // Fallback to reading the file as blob
                    this.readFileAsBlob(filePath, stats, startTime).then(resolve).catch(reject);
                };

                // Don't set crossOrigin for file:// URLs
                img.src = fileUrl;
            });
        } catch (error) {
            console.error(`Error processing ${filePath}:`, error);
            return {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: filePath.split(/[/\\]/).pop(),
                path: filePath,
                error: true,
                dataUrl: null
            };
        }
    }

    async readFileAsBlob(filePath, stats, startTime) {
        console.log(`📖 Reading ${filePath.split(/[/\\]/).pop()} as blob...`);
        const buffer = await window.electronAPI.readFile(filePath);
        const uint8Array = new Uint8Array(buffer);
        const extension = filePath.split('.').pop().toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp',
            'tiff': 'image/tiff',
            'svg': 'image/svg+xml'
        };
        const mimeType = mimeTypes[extension] || 'application/octet-stream';
        const blob = new Blob([uint8Array], { type: mimeType });
        const dataUrl = URL.createObjectURL(blob);

        // Track blob URLs for cleanup
        this.blobUrls.push(dataUrl);

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const totalTime = performance.now() - startTime;
                console.log(`✅ Blob loaded ${filePath.split(/[/\\]/).pop()} in ${totalTime.toFixed(2)}ms`);
                resolve({
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: filePath.split(/[/\\]/).pop(),
                    path: filePath,
                    dataUrl: dataUrl,
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    aspectRatio: img.naturalWidth / img.naturalHeight,
                    size: stats.size,
                    mtimeMs: stats.mtimeMs,
                    mtimeISO: stats.mtimeISO
                });
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    cleanupBlobUrls() {
        if (this.blobUrls) {
            this.blobUrls.forEach(url => URL.revokeObjectURL(url));
            this.blobUrls = [];
        }
    }

    isImageFile(file) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'];
        const fileName = (file?.name || file?.path || '').toLowerCase();
        return imageExtensions.some(ext => fileName.endsWith(ext));
    }

    renderGallery() {
        console.log(`🔍 DEBUG: Starting gallery render for ${this.images.length} images...`);
        const renderStart = performance.now();

        // Clear existing content
        this.galleryGrid.innerHTML = '';

        // Use DocumentFragment for better performance
        const fragment = document.createDocumentFragment();

        this.images.forEach((image, index) => {
            if (image.error) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'image-error';

                const iconDiv = document.createElement('div');
                iconDiv.className = 'image-error-icon';
                iconDiv.textContent = '⚠️';

                const messageDiv = document.createElement('div');
                messageDiv.textContent = 'Failed to load';

                const nameDiv = document.createElement('div');
                nameDiv.style.fontSize = '0.8rem';
                nameDiv.style.opacity = '0.7';
                nameDiv.textContent = image.name;

                errorDiv.appendChild(iconDiv);
                errorDiv.appendChild(messageDiv);
                errorDiv.appendChild(nameDiv);

                errorDiv.addEventListener('click', () => this.openFullscreen(index));
                fragment.appendChild(errorDiv);
            } else {
                const img = document.createElement('img');
                img.className = 'gallery-image';
                img.src = image.dataUrl;
                img.alt = image.name;
                img.loading = 'lazy'; // Defer loading off-screen images
                img.decoding = 'async'; // Don't block on image decoding
                img.addEventListener('click', () => this.openFullscreen(index));
                fragment.appendChild(img);
            }
        });

        this.galleryGrid.appendChild(fragment);
        const renderTime = performance.now() - renderStart;
        console.log(`🔍 DEBUG: Gallery render completed in ${renderTime.toFixed(2)}ms`);
    }

    openFullscreen(index) {
        if (this.images.length === 0) return;

        if (this.images[index].error) {
            console.warn(`Cannot open fullscreen for failed image: ${this.images[index].name}`);
            return;
        }

        this.currentIndex = index;
        this.isFullscreen = true;

        this.updateFullscreenImage();
        this.updateNavigationButtons();
        this.fullscreenOverlay.classList.remove('hidden');

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        // Add fullscreen-specific event listeners
        this.fullscreenOverlay.onclick = (e) => {
            if (e.target === this.fullscreenOverlay) this.closeFullscreen();
        };

        let wheelTimeout;
        this.fullscreenWheelHandler = (e) => {
            e.preventDefault();
            // Debounce wheel events to prevent too rapid navigation
            clearTimeout(wheelTimeout);
            wheelTimeout = setTimeout(() => {
                if (e.deltaX > 0 || e.deltaY > 0) this.showNext();
                else if (e.deltaX < 0 || e.deltaY < 0) this.showPrevious();
            }, 50);
        };
        this.fullscreenOverlay.addEventListener('wheel', this.fullscreenWheelHandler, { passive: false });
    }

    closeFullscreen() {
        this.isFullscreen = false;
        this.fullscreenOverlay.classList.add('hidden');
        document.body.style.overflow = '';

        // Clean up event listeners
        this.fullscreenOverlay.onclick = null;
        if (this.fullscreenWheelHandler) {
            this.fullscreenOverlay.removeEventListener('wheel', this.fullscreenWheelHandler);
            this.fullscreenWheelHandler = null;
        }
    }

    showPrevious() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateFullscreenImage();
        }
    }

    showNext() {
        if (this.currentIndex < this.images.length - 1) {
            this.currentIndex++;
            this.updateFullscreenImage();
        }
    }

    updateFullscreenImage() {
        const image = this.images[this.currentIndex];
        if (!image || image.error) return;

        this.fullscreenImage.src = image.dataUrl;
        this.fullscreenImage.alt = image.name;
        this.updateNavigationButtons();
    }

    updateNavigationButtons() {
        this.prevBtn.disabled = this.currentIndex === 0;
        this.nextBtn.disabled = this.currentIndex === this.images.length - 1;
    }

    handleKeydown(e) {
        // Global shortcuts
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            console.log('🔍 DEBUG: Exporting debug logs...');
            this.exportDebugLogs();
            return;
        }

        if (!this.isFullscreen) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.showPrevious();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.showNext();
                break;
            case 'Escape':
                e.preventDefault();
                this.closeFullscreen();
                break;
        }
    }

    showLoading() {
        this.loadingIndicator.classList.remove('hidden');
        this.loadingProgress.classList.add('hidden');
        this.loadingText.textContent = 'Loading images...';
    }

    hideLoading() {
        this.loadingIndicator.classList.add('hidden');
    }

    updateProgress(current, total) {
        if (!this.loadingProgress || !this.progressFill || !this.progressText) {
            console.warn('⚠️ Loading UI elements not found - progress cannot be displayed');
            return;
        }

        this.loadingProgress.classList.remove('hidden');
        const percentage = total > 0 ? (current / total) * 100 : 0;
        this.progressFill.style.width = `${percentage}%`;
        this.progressText.textContent = `${current} / ${total}`;
        this.loadingText.textContent = `Loading images... (${current}/${total})`;
    }

    hideDropZone() {
        this.dropZone.classList.add('hidden');
        this.galleryGrid.classList.remove('hidden');
    }

    showDropZone() {
        this.dropZone.classList.remove('hidden');
        this.galleryGrid.classList.add('hidden');
    }
}

// Initialize the gallery when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ImageGallery();
});

// Handle window resize for responsive grid
window.addEventListener('resize', () => {
    // Gallery will automatically adjust via CSS grid
    // Could add more sophisticated responsive logic here if needed
});
