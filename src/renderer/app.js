// Image Gallery Manager - Renderer Process Entry Point
// This is a temporary bootstrap that will be replaced with a modern framework (React/Vue/Svelte)

class ImageGalleryManager {
    constructor() {
        this.initialized = false;
        this.currentView = 'loading';

        // Gallery state
        this.galleryImages = []; // Array of loaded images
        this.columnWidth = 300; // Default column width in pixels
        this.columns = 4; // Default number of columns

        this.init();
    }

    async init() {
        try {
            // Update loading status
            window.loadingUtils.updateStatus('Initializing application...');

            // Wait for electron API to be available
            await this.waitForElectronAPI();

            // Initialize database connection
            window.loadingUtils.updateStatus('Connecting to database...');
            await this.initializeDatabase();

            // Load settings
            window.loadingUtils.updateStatus('Loading settings...');
            await this.loadSettings();

            // Initialize UI components
            window.loadingUtils.updateStatus('Setting up interface...');
            await this.initializeUI();

            // Mark as initialized
            this.initialized = true;

            // Hide loading screen and show main interface
            window.loadingUtils.hide();

            console.log('Image Gallery Manager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showError('Failed to initialize application: ' + error.message);
        }
    }

    async waitForElectronAPI() {
        return new Promise((resolve) => {
            const checkAPI = () => {
                if (window.electronAPI) {
                    resolve();
                } else {
                    setTimeout(checkAPI, 10);
                }
            };
            checkAPI();
        });
    }

    async initializeDatabase() {
        const result = await window.electronAPI.db.init();
        if (!result.success) {
            throw new Error('Database initialization failed: ' + result.error);
        }
    }

    async loadSettings() {
        const result = await window.electronAPI.settings.get();
        if (result.success) {
            this.settings = result.data;
        } else {
            console.warn('Failed to load settings, using defaults');
            this.settings = {};
        }
    }

    async initializeUI() {
        // Create main UI structure
        this.createMainLayout();

        // Initialize components
        this.initializeHeader();
        this.initializeSidebar();
        this.initializeMainContent();
        this.initializeStatusBar();

        // Set up event listeners
        this.setupEventListeners();

        // Load initial data
        await this.loadInitialData();
    }

    createMainLayout() {
        const app = document.getElementById('app');

        app.innerHTML = `
            <div class="app-container">
                <header class="app-header">
                    <div class="header-left">
                        <h1 class="app-title">Image Gallery Manager</h1>
                    </div>
                    <div class="header-center">
                        <div class="search-container">
                            <input type="text" class="search-input" placeholder="Search images, tags, artists...">
                            <button class="search-button">🔍</button>
                        </div>
                    </div>
                    <div class="header-right">
                        <button class="header-button" id="settings-btn">⚙️</button>
                        <button class="header-button" id="minimize-btn">−</button>
                        <button class="header-button" id="maximize-btn">⬜</button>
                        <button class="header-button" id="close-btn">✕</button>
                    </div>
                </header>

                <div class="app-main">
                    <aside class="sidebar">
                        <nav class="sidebar-nav">
                            <button class="nav-button active" data-view="gallery">
                                🖼️ Gallery
                            </button>
                            <button class="nav-button" data-view="tags">
                                🏷️ Tags
                            </button>
                            <button class="nav-button" data-view="sets">
                                📁 Sets
                            </button>
                            <button class="nav-button" data-view="import">
                                📥 Import
                            </button>
                            <button class="nav-button" data-view="settings">
                                ⚙️ Settings
                            </button>
                        </nav>
                    </aside>

                    <main class="main-content">
                        <div class="content-area" id="content-area">
                            <!-- Content will be loaded here -->
                        </div>
                    </main>
                </div>

                <footer class="status-bar">
                    <div class="status-left">
                        <span id="status-text">Ready</span>
                    </div>
                    <div class="status-right">
                        <span id="stats-text">0 images</span>
                    </div>
                </footer>
            </div>
        `;
    }

    initializeHeader() {
        // Window controls - with error handling
        const minimizeBtn = document.getElementById('minimize-btn');
        const maximizeBtn = document.getElementById('maximize-btn');
        const closeBtn = document.getElementById('close-btn');

        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                window.electronAPI.window.minimize();
            });
        }

        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', () => {
                window.electronAPI.window.maximize();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                window.electronAPI.window.close();
            });
        }
    }

    initializeSidebar() {
        // Navigation buttons
        const navButtons = document.querySelectorAll('.nav-button');

        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const view = e.target.dataset.view;
                this.switchView(view);
            });
        });
    }

    initializeMainContent() {
        this.showGalleryView();
    }

    initializeStatusBar() {
        // Status bar is already created in HTML
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Import card event listeners
        const archiveCard = document.querySelector('.import-archive-card');
        const urlCard = document.querySelector('.import-url-card');
        const directoryCard = document.querySelector('.import-directory-card');

        if (archiveCard) {
            archiveCard.addEventListener('click', () => this.importFromArchive());
        }
        if (urlCard) {
            urlCard.addEventListener('click', () => this.importFromUrl());
        }
        if (directoryCard) {
            directoryCard.addEventListener('click', () => this.importFromDirectory());
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'f':
                        e.preventDefault();
                        if (searchInput) searchInput.focus();
                        break;
                    case 'k':
                        if (e.shiftKey) {
                            e.preventDefault();
                            // TODO: Open command palette
                        }
                        break;
                }
            }
        });
    }

    async loadInitialData() {
        try {
            // Load tags
            const tagsResult = await window.electronAPI.tags.getAll();
            if (tagsResult.success) {
                this.tags = tagsResult.data;
            } else {
                console.error('Failed to load tags:', tagsResult.error);
                this.showError('Failed to load tags. Some features may not work properly.');
            }

            // Load image count - Note: db.query removed for security, need to add specific IPC channel
            // For now, we'll show 0 until we implement proper image counting
            this.updateStats(0);

            this.updateStatus('Ready');
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.showError('Failed to load application data. Please restart the application.');
        }
    }

    switchView(view) {
        // Update active navigation button
        document.querySelectorAll('.nav-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-view="${view}"]`).classList.add('active');

        // Switch content
        switch (view) {
            case 'gallery':
                this.showGalleryView();
                break;
            case 'tags':
                this.showTagsView();
                break;
            case 'sets':
                this.showSetsView();
                break;
            case 'import':
                this.showImportView();
                break;
            case 'settings':
                this.showSettingsView();
                break;
        }

        // Keep currentView in sync
        this.currentView = view;
    }

    showGalleryView() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="gallery-view">
                <div class="gallery-header">
                    <div class="gallery-info">
                        <span id="gallery-count">${this.galleryImages.length} images</span>
                    </div>
                    <div class="gallery-actions">
                        <button class="secondary-button" id="select-files-btn">Add Images</button>
                    </div>
                </div>
                <div class="gallery-container" id="gallery-container">
                    <div class="gallery-grid" id="gallery-grid">
                        ${this.renderGalleryGrid()}
                    </div>
                    <div class="gallery-drop-zone" id="gallery-drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-icon">📸</div>
                            <h3>Drop Images Here</h3>
                            <p>or click "Add Images" above</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Set up event listeners
        this.setupGalleryEventListeners();

        // Set up drag and drop
        this.setupDragAndDrop();
    }

    renderGalleryGrid() {
        if (this.galleryImages.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-icon">🖼️</div>
                    <h3>No Images Yet</h3>
                    <p>Drag and drop images here or use "Add Images"</p>
                </div>
            `;
        }

        return this.galleryImages.map(image => `
            <div class="gallery-item" data-image-id="${image.id}" data-image-path="${image.path}">
                <div class="image-container">
                    <img src="" alt="${image.filename}" class="gallery-image" loading="lazy">
                    <div class="image-overlay">
                        <div class="image-info">
                            <span class="image-name">${image.filename}</span>
                            <span class="image-size">${this.formatFileSize(image.size)}</span>
                        </div>
                    </div>
                    <div class="image-error" style="display: none;">
                        <span>⚠️ Failed to load</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    setupGalleryEventListeners() {
        // Add images button
        const selectBtn = document.getElementById('select-files-btn');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.selectImages());
        }

        // Gallery item clicks for fullscreen
        const galleryGrid = document.getElementById('gallery-grid');
        if (galleryGrid) {
            galleryGrid.addEventListener('click', (event) => {
                const galleryItem = event.target.closest('.gallery-item');
                if (galleryItem) {
                    const imageId = galleryItem.dataset.imageId;
                    const image = this.galleryImages.find(img => img.id === imageId);
                    if (image) {
                        this.openFullscreen(image);
                    }
                }
            });
        }
    }

    setupDragAndDrop() {
        const dropZone = document.getElementById('gallery-drop-zone');
        const galleryContainer = document.getElementById('gallery-container');

        if (!dropZone || !galleryContainer) return;

        // Drag over
        galleryContainer.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
            galleryContainer.classList.add('drag-over');
        });

        // Drag leave
        galleryContainer.addEventListener('dragleave', (event) => {
            event.preventDefault();
            event.stopPropagation();
            // Only remove class if leaving the container entirely
            if (!galleryContainer.contains(event.relatedTarget)) {
                galleryContainer.classList.remove('drag-over');
            }
        });

        // Drop
        galleryContainer.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
            galleryContainer.classList.remove('drag-over');

            const files = Array.from(event.dataTransfer.files);
            this.handleDroppedFiles(files);
        });
    }

    async selectImages() {
        try {
            const result = await window.electronAPI.files.selectImages();
            if (result.success) {
                await this.loadImagesFromPaths(result.data.files);
            }
        } catch (error) {
            this.showError(`Failed to select images: ${error.message}`);
        }
    }

    async handleDroppedFiles(files) {
        // Filter to only image files
        const imageFiles = files.filter(file => {
            const ext = file.name.toLowerCase().split('.').pop();
            return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif'].includes(ext);
        });

        if (imageFiles.length === 0) {
            this.showError('No valid image files found in drop');
            return;
        }

        const filePaths = imageFiles.map(file => file.path);
        await this.loadImagesFromPaths(filePaths);
    }

    async loadImagesFromPaths(filePaths) {
        try {
            const validImages = [];

            for (const filePath of filePaths) {
                try {
                    // Validate format first
                    const validation = await window.electronAPI.images.validateFormat(filePath);
                    if (validation.success && validation.data.isValid) {
                        // Load metadata
                        const metadata = await window.electronAPI.images.loadMetadata(filePath);
                        if (metadata.success) {
                            validImages.push(metadata.data);
                        }
                    }
                } catch (error) {
                    console.warn(`Skipping invalid image ${filePath}:`, error);
                }
            }

            if (validImages.length === 0) {
                this.showError('No valid images could be loaded');
                return;
            }

            // Add to gallery
            this.galleryImages.push(...validImages);

            // Update the display
            this.updateGalleryDisplay();

            // Load the images (start with visible ones)
            this.loadVisibleImages();

        } catch (error) {
            this.showError(`Failed to load images: ${error.message}`);
        }
    }

    updateGalleryDisplay() {
        const galleryGrid = document.getElementById('gallery-grid');
        const galleryCount = document.getElementById('gallery-count');

        if (galleryGrid) {
            galleryGrid.innerHTML = this.renderGalleryGrid();
        }

        if (galleryCount) {
            galleryCount.textContent = `${this.galleryImages.length} image${this.galleryImages.length !== 1 ? 's' : ''}`;
        }
    }

    async loadVisibleImages() {
        // Simple lazy loading - load all images for now (can be optimized later)
        const imageElements = document.querySelectorAll('.gallery-image');

        for (const imgElement of imageElements) {
            const galleryItem = imgElement.closest('.gallery-item');
            if (!galleryItem) continue;

            const imagePath = galleryItem.dataset.imagePath;
            if (!imagePath) continue;

            try {
                // Load full-quality image (we'll optimize this later)
                const result = await window.electronAPI.images.getFullQuality(imagePath);
                if (result.success) {
                    const blob = new Blob([result.data], { type: 'image/jpeg' });
                    const url = URL.createObjectURL(blob);
                    imgElement.src = url;

                    // Clean up object URL when image loads
                    imgElement.addEventListener('load', () => {
                        URL.revokeObjectURL(url);
                    });
                } else {
                    this.showImageError(imgElement);
                }
            } catch (error) {
                console.error(`Failed to load image ${imagePath}:`, error);
                this.showImageError(imgElement);
            }
        }
    }

    showImageError(imgElement) {
        const galleryItem = imgElement.closest('.gallery-item');
        if (galleryItem) {
            const errorDiv = galleryItem.querySelector('.image-error');
            if (errorDiv) {
                errorDiv.style.display = 'flex';
            }
        }
        imgElement.style.display = 'none';
    }

    openFullscreen(image) {
        const currentIndex = this.galleryImages.findIndex(img => img.id === image.id);
        if (currentIndex === -1) return;

        // Create fullscreen overlay
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '10000',
            cursor: 'default'
        });

        // Create image container
        const imageContainer = document.createElement('div');
        Object.assign(imageContainer.style, {
            position: 'relative',
            maxWidth: '90vw',
            maxHeight: '90vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        // Create image element
        const fsImage = document.createElement('img');
        Object.assign(fsImage.style, {
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            borderRadius: '4px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
        });
        fsImage.alt = image.filename;

        // Create navigation controls
        const navLeft = document.createElement('button');
        Object.assign(navLeft.style, {
            position: 'absolute',
            left: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '50px',
            height: '50px',
            fontSize: '24px',
            cursor: 'pointer',
            display: currentIndex > 0 ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.2s'
        });
        navLeft.textContent = '‹';
        navLeft.addEventListener('click', () => this.navigateFullscreen(-1));

        const navRight = document.createElement('button');
        Object.assign(navRight.style, {
            position: 'absolute',
            right: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '50px',
            height: '50px',
            fontSize: '24px',
            cursor: 'pointer',
            display: currentIndex < this.galleryImages.length - 1 ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.2s'
        });
        navRight.textContent = '›';
        navRight.addEventListener('click', () => this.navigateFullscreen(1));

        // Create close button
        const closeBtn = document.createElement('button');
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            fontSize: '20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.2s'
        });
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.closeFullscreen());

        // Create image info overlay
        const infoOverlay = document.createElement('div');
        Object.assign(infoOverlay.style, {
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '20px',
            fontSize: '14px',
            textAlign: 'center',
            opacity: '0',
            transition: 'opacity 0.3s',
            pointerEvents: 'none'
        });
        infoOverlay.textContent = `${currentIndex + 1} / ${this.galleryImages.length} • ${image.filename} • ${this.formatFileSize(image.size)}`;

        // Add hover effect for info
        imageContainer.addEventListener('mouseenter', () => {
            infoOverlay.style.opacity = '1';
        });
        imageContainer.addEventListener('mouseleave', () => {
            infoOverlay.style.opacity = '0';
        });

        // Assemble the overlay
        imageContainer.appendChild(fsImage);
        imageContainer.appendChild(navLeft);
        imageContainer.appendChild(navRight);
        imageContainer.appendChild(closeBtn);
        imageContainer.appendChild(infoOverlay);
        overlay.appendChild(imageContainer);

        // Store fullscreen state
        this.fullscreenState = {
            overlay,
            fsImage,
            navLeft,
            navRight,
            infoOverlay,
            currentIndex
        };

        // Load the image
        this.loadFullscreenImage(image);

        // Add to DOM
        document.body.appendChild(overlay);

        // Set up keyboard navigation
        this.setupKeyboardNavigation();

        // Focus the overlay for keyboard events
        overlay.focus();
    }

    async loadFullscreenImage(image) {
        if (!this.fullscreenState) return;

        const { fsImage } = this.fullscreenState;

        try {
            const result = await window.electronAPI.images.getFullQuality(image.path);
            if (result.success) {
                const blob = new Blob([result.data], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                fsImage.src = url;

                // Clean up object URL when image loads
                fsImage.addEventListener('load', () => {
                    URL.revokeObjectURL(url);
                });
            } else {
                fsImage.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1zaXplPSIxNiIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RXJyb3I6IEZhYWxlZCB0byBsb2FkPC90ZXh0Pjwvc3ZnPg==';
            }
        } catch (error) {
            console.error('Failed to load fullscreen image:', error);
            fsImage.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1zaXplPSIxNiIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RXJyb3I6IEZhYWxlZCB0byBsb2FkPC90ZXh0Pjwvc3ZnPg==';
        }
    }

    navigateFullscreen(direction) {
        if (!this.fullscreenState) return;

        const { currentIndex, navLeft, navRight, infoOverlay } = this.fullscreenState;
        const newIndex = currentIndex + direction;

        if (newIndex >= 0 && newIndex < this.galleryImages.length) {
            this.fullscreenState.currentIndex = newIndex;
            const newImage = this.galleryImages[newIndex];

            // Update navigation buttons
            navLeft.style.display = newIndex > 0 ? 'flex' : 'none';
            navRight.style.display = newIndex < this.galleryImages.length - 1 ? 'flex' : 'none';

            // Update info
            infoOverlay.textContent = `${newIndex + 1} / ${this.galleryImages.length} • ${newImage.filename} • ${this.formatFileSize(newImage.size)}`;

            // Load new image
            this.loadFullscreenImage(newImage);
        }
    }

    closeFullscreen() {
        if (!this.fullscreenState) return;

        const { overlay } = this.fullscreenState;
        document.body.removeChild(overlay);

        // Clean up keyboard navigation
        this.cleanupKeyboardNavigation();

        this.fullscreenState = null;
    }

    setupKeyboardNavigation() {
        this.keyboardHandler = (event) => {
            switch (event.key) {
                case 'ArrowLeft':
                    event.preventDefault();
                    this.navigateFullscreen(-1);
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    this.navigateFullscreen(1);
                    break;
                case 'Escape':
                    event.preventDefault();
                    this.closeFullscreen();
                    break;
            }
        };

        document.addEventListener('keydown', this.keyboardHandler);
    }

    cleanupKeyboardNavigation() {
        if (this.keyboardHandler) {
            document.removeEventListener('keydown', this.keyboardHandler);
            this.keyboardHandler = null;
        }
    }

    showTagsView() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="tags-view">
                <div class="tags-header">
                    <h2>Tag Management</h2>
                    <button class="primary-button" id="add-tag-btn">Add Tag</button>
                </div>
                <div class="tags-list" id="tags-list">
                    <!-- Tags will be loaded here -->
                </div>
            </div>
        `;

        this.loadTagsList();
    }

    showSetsView() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="sets-view">
                <div class="sets-header">
                    <h2>Image Sets</h2>
                    <button class="primary-button">Create Set</button>
                </div>
                <div class="sets-grid" id="sets-grid">
                    <div class="empty-state">
                        <div class="empty-icon">📁</div>
                        <h3>No Sets Yet</h3>
                        <p>Create sets to group related images</p>
                    </div>
                </div>
            </div>
        `;
    }

    showImportView() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="import-view">
                <div class="import-header">
                    <h2>Import Images</h2>
                </div>
                <div class="import-options">
                    <div class="import-card import-archive-card">
                        <div class="card-icon">📦</div>
                        <h3>From Archive</h3>
                        <p>Import images from ZIP, RAR, or 7Z files</p>
                    </div>
                    <div class="import-card import-url-card">
                        <div class="card-icon">🌐</div>
                        <h3>From URL</h3>
                        <p>Download and import from web URLs</p>
                    </div>
                    <div class="import-card import-directory-card">
                        <div class="card-icon">📁</div>
                        <h3>From Directory</h3>
                        <p>Import images from local folders</p>
                    </div>
                </div>
            </div>
        `;
    }

    showSettingsView() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="settings-view">
                <div class="settings-header">
                    <h2>Settings</h2>
                </div>
                <div class="settings-content">
                    <div class="setting-group">
                        <h3>Library</h3>
                        <div class="setting-item">
                            <label>Library Size Limit (GB)</label>
                            <input type="number" min="0.5" max="100" step="0.5" value="2">
                        </div>
                    </div>
                    <div class="setting-group">
                        <h3>Interface</h3>
                        <div class="setting-item">
                            <label>Theme</label>
                            <select>
                                <option value="dark">Dark</option>
                                <option value="light">Light</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async loadTagsList() {
        const tagsList = document.getElementById('tags-list');

        // Clear existing content
        tagsList.innerHTML = '';

        if (!this.tags || this.tags.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = 'No tags yet. Create your first tag to organize your images.';
            tagsList.appendChild(emptyMessage);
            return;
        }

        // Create tag items safely using DOM API
        const fragment = document.createDocumentFragment();
        for (const tag of this.tags) {
            const tagItem = document.createElement('div');
            tagItem.className = 'tag-item';
            tagItem.style.borderLeftColor = tag.color || '#007acc';

            const tagInfo = document.createElement('div');
            tagInfo.className = 'tag-info';

            const tagName = document.createElement('span');
            tagName.className = 'tag-name';
            tagName.textContent = tag.name; // Safe: textContent prevents XSS

            const tagCategory = document.createElement('span');
            tagCategory.className = 'tag-category';
            tagCategory.textContent = tag.category; // Safe: textContent prevents XSS

            tagInfo.appendChild(tagName);
            tagInfo.appendChild(tagCategory);

            const tagStats = document.createElement('div');
            tagStats.className = 'tag-stats';

            const tagCount = document.createElement('span');
            tagCount.className = 'tag-count';
            tagCount.textContent = `${tag.usage_count || 0} images`; // Safe: textContent prevents XSS

            tagStats.appendChild(tagCount);

            tagItem.appendChild(tagInfo);
            tagItem.appendChild(tagStats);
            fragment.appendChild(tagItem);
        }

        tagsList.appendChild(fragment);
    }

    // Import methods (placeholders for now)
    async importFromArchive() {
        this.updateStatus('Archive import not yet implemented');
    }

    async importFromUrl() {
        this.updateStatus('URL import not yet implemented');
    }

    async importFromDirectory() {
        this.updateStatus('Directory import not yet implemented');
    }

    handleSearch(query) {
        // TODO: Implement search functionality
        console.log('Search query:', query);
    }

    updateStatus(text) {
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.textContent = text;
        }
    }

    updateStats(count) {
        const statsText = document.getElementById('stats-text');
        if (statsText) {
            statsText.textContent = `${count} image${count !== 1 ? 's' : ''}`;
        }
    }

    showError(message) {
        // Create a proper error dialog instead of using alert()
        const errorDialog = document.createElement('div');
        Object.assign(errorDialog.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#2d2d2d',
            color: '#ffffff',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: '10000',
            maxWidth: '400px',
            fontFamily: 'Arial, sans-serif'
        });

        // Create dialog content safely using DOM API
        const headerDiv = document.createElement('div');
        Object.assign(headerDiv.style, {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '15px'
        });

        const warningSpan = document.createElement('span');
        Object.assign(warningSpan.style, {
            color: '#ff6b6b',
            fontSize: '20px',
            marginRight: '10px'
        });
        warningSpan.textContent = '⚠️';

        const titleStrong = document.createElement('strong');
        titleStrong.textContent = 'Error';

        headerDiv.appendChild(warningSpan);
        headerDiv.appendChild(titleStrong);

        const messageP = document.createElement('p');
        Object.assign(messageP.style, {
            margin: '0 0 20px 0',
            lineHeight: '1.4'
        });
        messageP.textContent = message; // Safe: textContent prevents XSS

        const okBtn = document.createElement('button');
        Object.assign(okBtn.style, {
            background: '#007acc',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            float: 'right'
        });
        okBtn.textContent = 'OK';

        errorDialog.appendChild(headerDiv);
        errorDialog.appendChild(messageP);
        errorDialog.appendChild(okBtn);

        document.body.appendChild(errorDialog);

        if (okBtn) {
            okBtn.addEventListener('click', () => {
                document.body.removeChild(errorDialog);
            });
        }

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (document.body.contains(errorDialog)) {
                document.body.removeChild(errorDialog);
            }
        }, 10000);
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ImageGalleryManager();
});

// Export for debugging
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageGalleryManager;
}
