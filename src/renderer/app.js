// Image Gallery Manager - Renderer Process Entry Point
// This is a temporary bootstrap that will be replaced with a modern framework (React/Vue/Svelte)

class ImageGalleryManager {
    constructor() {
        this.initialized = false;
        this.currentView = 'loading';

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
                <div class="gallery-controls">
                    <div class="control-group">
                        <label>Sort by:</label>
                        <select class="control-select">
                            <option value="date-desc">Newest First</option>
                            <option value="date-asc">Oldest First</option>
                            <option value="name">Name</option>
                            <option value="artist">Artist</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label>View:</label>
                        <select class="control-select">
                            <option value="grid">Grid</option>
                            <option value="list">List</option>
                        </select>
                    </div>
                </div>
                <div class="gallery-grid" id="gallery-grid">
                    <div class="empty-state">
                        <div class="empty-icon">🖼️</div>
                        <h3>No Images Yet</h3>
                        <p>Import some images to get started</p>
                        <button class="primary-button" onclick="app.switchView('import')">Import Images</button>
                    </div>
                </div>
            </div>
        `;
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

        if (!this.tags || this.tags.length === 0) {
            tagsList.innerHTML = '<p class="empty-message">No tags yet. Create your first tag to organize your images.</p>';
            return;
        }

        const tagsHTML = this.tags.map(tag => `
            <div class="tag-item" style="border-left-color: ${tag.color || '#007acc'}">
                <div class="tag-info">
                    <span class="tag-name">${tag.name}</span>
                    <span class="tag-category">${tag.category}</span>
                </div>
                <div class="tag-stats">
                    <span class="tag-count">${tag.usage_count || 0} images</span>
                </div>
            </div>
        `).join('');

        tagsList.innerHTML = tagsHTML;
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

        errorDialog.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <span style="color: #ff6b6b; font-size: 20px; margin-right: 10px;">⚠️</span>
                <strong>Error</strong>
            </div>
            <p style="margin: 0 0 20px 0; line-height: 1.4;">${message}</p>
            <button id="error-ok-btn" style="
                background: #007acc;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                float: right;
            ">OK</button>
        `;

        document.body.appendChild(errorDialog);

        const okBtn = errorDialog.querySelector('#error-ok-btn');
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
