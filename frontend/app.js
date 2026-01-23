/**
 * Voice-Activated Teleprompter - Frontend Application
 *
 * Captures audio from browser microphone, streams to server for Vosk recognition,
 * and highlights/scrolls the script as the user speaks.
 */

class Teleprompter {
    constructor() {
        // DOM elements
        this.setupPanel = document.getElementById('setup-panel');
        this.teleprompterView = document.getElementById('teleprompter');
        this.scriptInput = document.getElementById('script-input');
        this.scriptDisplay = document.getElementById('script-display');
        this.modelSelect = document.getElementById('model-select');
        this.fontSizeSlider = document.getElementById('font-size');
        this.fontSizeValue = document.getElementById('font-size-value');
        this.scrollMarginSlider = document.getElementById('scroll-margin');
        this.scrollMarginValue = document.getElementById('scroll-margin-value');
        this.mirrorHorizontal = document.getElementById('mirror-horizontal');
        this.mirrorVertical = document.getElementById('mirror-vertical');
        this.showHighlight = document.getElementById('show-highlight');
        this.startBtn = document.getElementById('start-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.restartBtn = document.getElementById('restart-btn');
        this.connectionStatus = document.getElementById('connection-status');
        this.recognitionStatus = document.getElementById('recognition-status');
        this.progressIndicator = document.getElementById('progress-indicator');

        // Save/Load elements
        this.saveBtn = document.getElementById('save-btn');
        this.loadBtn = document.getElementById('load-btn');
        this.saveModal = document.getElementById('save-modal');
        this.loadModal = document.getElementById('load-modal');

        // State
        this.ws = null;
        this.scriptWords = [];
        this.wordElements = [];
        this.currentWordIndex = 0;
        this.isRunning = false;
        this.scrollMarginPercent = 30;
        this.mode = 'voice'; // 'voice' or 'manual'
        this.speechEngine = 'browser'; // 'browser' or 'vosk'
        this.webSpeechRecognition = null;

        // Auto-advance state
        this.readingSpeed = 900; // characters per minute
        this.autoAdvanceInterval = null;
        this.isScrollPaused = false;

        // Hold-to-advance state (spacebar advances word marker)
        this.isSpaceHeld = false;
        this.advanceInterval = null;
        this.lastSpacePress = 0; // for double-tap detection
        this.doubleTapThreshold = 300; // ms

        // Line tracking for jump-to-next-line
        this.lineStartIndices = [];

        // Numbered cue points for quick navigation
        this.cuePoints = {}; // { cueNumber: { wordIndex, element } }
        this.cueInputBuffer = '';
        this.cueInputTimeout = null;

        // Match tolerance for dialect support (100 = exact, lower = fuzzy)
        this.matchTolerance = 100;

        // Smooth scroll animation
        this.scrollAnimationId = null;

        // Audio capture
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;

        // Theme preference
        this.themePreference = 'dark';

        // Error tracking
        this.networkErrorShown = false;
        this.storageQuotaWarningShown = false;
        this.localStorageAvailable = true;

        this.init();
    }

    async init() {
        this.bindEvents();
        this.checkLocalStorage();
        this.applyStoredSettings();
        await this.loadModels();
        await this.checkUrlForScript();

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            // Only update if theme preference is 'system'
            if (this.themePreference === 'system') {
                const effectiveTheme = e.matches ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', effectiveTheme);
            }
        });
    }

    checkLocalStorage() {
        // Check if localStorage is available
        try {
            localStorage.setItem('test', 'test');
            localStorage.removeItem('test');
            this.localStorageAvailable = true;
        } catch (e) {
            this.localStorageAvailable = false;
            this.showInfo(
                'Settings Won\'t Be Saved',
                'Your browser is in private/incognito mode or has storage disabled.',
                'Settings will work during this session but won\'t be remembered after closing the tab.'
            );
        }
    }

    safeSetLocalStorage(key, value) {
        if (!this.localStorageAvailable) return;

        try {
            localStorage.setItem(key, value);
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                // Only show warning once
                if (!this.storageQuotaWarningShown) {
                    this.showWarning(
                        'Settings Storage Full',
                        'Your browser\'s storage is full. Settings may not be saved.',
                        'Clear some browser data or continue without saving settings.'
                    );
                    this.storageQuotaWarningShown = true;
                }
            }
        }
    }

    applyStoredSettings() {
        // Restore font size
        const savedFontSize = localStorage.getItem('teleprompter-fontSize');
        if (savedFontSize) {
            this.fontSizeSlider.value = savedFontSize;
            this.fontSizeValue.textContent = `${savedFontSize}px`;
            this.scriptDisplay.style.fontSize = `${savedFontSize}px`;
            const previewText = document.getElementById('preview-text');
            if (previewText) previewText.style.fontSize = `${savedFontSize}px`;
        } else {
            const fontSize = this.fontSizeSlider.value;
            this.fontSizeValue.textContent = `${fontSize}px`;
            this.scriptDisplay.style.fontSize = `${fontSize}px`;
            const previewText = document.getElementById('preview-text');
            if (previewText) previewText.style.fontSize = `${fontSize}px`;
        }

        // Restore scroll margin
        const savedScrollMargin = localStorage.getItem('teleprompter-scrollMargin');
        if (savedScrollMargin) {
            this.scrollMarginSlider.value = savedScrollMargin;
            this.scrollMarginPercent = parseInt(savedScrollMargin);
            this.scrollMarginValue.textContent = `${this.scrollMarginPercent}%`;
            const previewLine = document.getElementById('preview-line');
            if (previewLine) previewLine.style.top = `${this.scrollMarginPercent}%`;
        } else {
            this.scrollMarginPercent = parseInt(this.scrollMarginSlider.value);
            this.scrollMarginValue.textContent = `${this.scrollMarginPercent}%`;
            const previewLine = document.getElementById('preview-line');
            if (previewLine) previewLine.style.top = `${this.scrollMarginPercent}%`;
        }

        // Restore reading speed
        const speedSlider = document.getElementById('reading-speed');
        const savedSpeed = localStorage.getItem('teleprompter-readingSpeed');
        if (savedSpeed) {
            speedSlider.value = savedSpeed;
            this.readingSpeed = parseInt(savedSpeed);
        } else {
            this.readingSpeed = parseInt(speedSlider.value);
        }
        document.getElementById('speed-value').textContent = `${this.readingSpeed} CPM`;

        // Restore match tolerance
        const toleranceSlider = document.getElementById('match-tolerance');
        const savedTolerance = localStorage.getItem('teleprompter-matchTolerance');
        if (savedTolerance) {
            toleranceSlider.value = savedTolerance;
            this.matchTolerance = parseInt(savedTolerance);
        } else {
            this.matchTolerance = parseInt(toleranceSlider.value);
        }
        document.getElementById('tolerance-value').textContent = `${this.matchTolerance}%`;

        // Restore mirror settings
        const savedMirrorH = localStorage.getItem('teleprompter-mirrorHorizontal');
        if (savedMirrorH !== null) {
            this.mirrorHorizontal.checked = savedMirrorH === 'true';
        }
        const savedMirrorV = localStorage.getItem('teleprompter-mirrorVertical');
        if (savedMirrorV !== null) {
            this.mirrorVertical.checked = savedMirrorV === 'true';
        }

        // Restore show highlight
        const savedShowHighlight = localStorage.getItem('teleprompter-showHighlight');
        if (savedShowHighlight !== null) {
            this.showHighlight.checked = savedShowHighlight === 'true';
        }

        // Restore scroll mode from localStorage
        const savedMode = localStorage.getItem('teleprompter-mode') || 'voice';
        this.setMode(savedMode, false);

        // Restore speech engine from localStorage
        const savedEngine = localStorage.getItem('teleprompter-engine') || 'browser';
        this.setSpeechEngine(savedEngine, false);

        // Restore theme from localStorage
        const savedTheme = localStorage.getItem('teleprompter-theme') || 'dark';
        this.setTheme(savedTheme, false);

        // Restore highlight color from localStorage
        const savedColor = localStorage.getItem('teleprompter-highlightColor') || '#e94560';
        document.getElementById('highlight-color').value = savedColor;
        this.setHighlightColor(savedColor, false);
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.restartBtn.addEventListener('click', () => this.restart());

        this.fontSizeSlider.addEventListener('input', (e) => {
            const size = e.target.value;
            this.fontSizeValue.textContent = `${size}px`;
            this.scriptDisplay.style.fontSize = `${size}px`;
            // Update preview
            const previewText = document.getElementById('preview-text');
            if (previewText) previewText.style.fontSize = `${size}px`;
            this.safeSetLocalStorage('teleprompter-fontSize', size);
        });

        this.scrollMarginSlider.addEventListener('input', (e) => {
            this.scrollMarginPercent = parseInt(e.target.value);
            this.scrollMarginValue.textContent = `${this.scrollMarginPercent}%`;
            // Update preview line position
            const previewLine = document.getElementById('preview-line');
            if (previewLine) previewLine.style.top = `${this.scrollMarginPercent}%`;
            this.safeSetLocalStorage('teleprompter-scrollMargin', this.scrollMarginPercent);
        });

        this.mirrorHorizontal.addEventListener('change', () => {
            this.updateMirror();
            this.safeSetLocalStorage('teleprompter-mirrorHorizontal', this.mirrorHorizontal.checked);
        });
        this.mirrorVertical.addEventListener('change', () => {
            this.updateMirror();
            this.safeSetLocalStorage('teleprompter-mirrorVertical', this.mirrorVertical.checked);
        });

        this.showHighlight.addEventListener('change', () => {
            this.safeSetLocalStorage('teleprompter-showHighlight', this.showHighlight.checked);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // ? shows shortcuts help (works anytime)
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                this.toggleShortcutsModal();
                return;
            }

            if (!this.isRunning) return;

            if (e.key === 'Escape') {
                // Close shortcuts modal if open, otherwise stop
                const modal = document.getElementById('shortcuts-modal');
                if (!modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                    return;
                }
                this.stop();
                return;
            }

            // Ctrl pauses/resumes in both modes
            if (e.key === 'Control') {
                e.preventDefault();
                this.toggleScrollPause();
                return;
            }

            // Spacebar: double-tap jumps to next line, hold advances word marker
            if ((e.key === ' ' || e.code === 'Space') && !this.isSpaceHeld) {
                e.preventDefault();
                const now = Date.now();

                // Check for double-tap
                if (now - this.lastSpacePress < this.doubleTapThreshold) {
                    this.jumpToNextLine();
                    this.lastSpacePress = 0; // Reset to prevent triple-tap
                    return;
                }

                this.lastSpacePress = now;
                this.isSpaceHeld = true;

                // Delay first advance slightly to allow double-tap detection
                setTimeout(() => {
                    if (this.isSpaceHeld) {
                        this.advanceWord();
                        this.scheduleHoldAdvance();
                    }
                }, this.doubleTapThreshold);
                return;
            }

            // Number keys for cue point navigation
            if (/^[0-9]$/.test(e.key)) {
                e.preventDefault();
                this.handleCueInput(e.key);
                return;
            }

            // Speed controls (both modes)
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.adjustSpeed(50);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.adjustSpeed(-50);
            }
        });

        // Spacebar release stops word advance
        document.addEventListener('keyup', (e) => {
            if ((e.key === ' ' || e.code === 'Space') && this.isSpaceHeld) {
                this.isSpaceHeld = false;
                if (this.advanceInterval) {
                    clearTimeout(this.advanceInterval);
                    this.advanceInterval = null;
                }
            }
        });

        // Save/Load buttons
        this.saveBtn.addEventListener('click', () => this.saveScript());
        this.loadBtn.addEventListener('click', () => this.showLoadModal());

        // Reset Settings button
        document.getElementById('reset-settings-btn').addEventListener('click', () => this.resetSettings());

        // Save modal
        document.getElementById('close-save-modal').addEventListener('click', () => {
            this.saveModal.classList.add('hidden');
        });
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            const code = document.getElementById('save-code').textContent;
            navigator.clipboard.writeText(code);
        });
        document.getElementById('copy-url-btn').addEventListener('click', () => {
            const url = document.getElementById('save-url').value;
            navigator.clipboard.writeText(url);
        });

        // Load modal
        document.getElementById('close-load-modal').addEventListener('click', () => {
            this.loadModal.classList.add('hidden');
        });
        document.getElementById('load-code-btn').addEventListener('click', () => {
            const code = document.getElementById('load-code-input').value.trim();
            if (code) this.loadScript(code);
        });
        document.getElementById('load-code-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const code = e.target.value.trim();
                if (code) this.loadScript(code);
            }
        });

        // Shortcuts modal
        document.getElementById('close-shortcuts-modal').addEventListener('click', () => {
            document.getElementById('shortcuts-modal').classList.add('hidden');
        });

        // Fullscreen
        document.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        document.addEventListener('fullscreenchange', () => this.updateFullscreenButton());

        // PPTX import
        document.getElementById('import-pptx-btn').addEventListener('click', () => {
            document.getElementById('pptx-file-input').click();
        });
        document.getElementById('pptx-file-input').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importPptx(e.target.files[0]);
                e.target.value = ''; // Reset for re-upload
            }
        });

        // Mode toggle
        document.getElementById('mode-voice').addEventListener('click', () => this.setMode('voice'));
        document.getElementById('mode-manual').addEventListener('click', () => this.setMode('manual'));

        // Reading speed slider
        const speedSlider = document.getElementById('reading-speed');
        const speedValue = document.getElementById('speed-value');
        speedSlider.addEventListener('input', (e) => {
            this.readingSpeed = parseInt(e.target.value);
            speedValue.textContent = `${this.readingSpeed} CPM`;
            this.safeSetLocalStorage('teleprompter-readingSpeed', this.readingSpeed);
        });

        // Match tolerance slider
        const toleranceSlider = document.getElementById('match-tolerance');
        const toleranceValue = document.getElementById('tolerance-value');
        toleranceSlider.addEventListener('input', (e) => {
            this.matchTolerance = parseInt(e.target.value);
            toleranceValue.textContent = `${this.matchTolerance}%`;
            this.safeSetLocalStorage('teleprompter-matchTolerance', this.matchTolerance);
        });

        // Speech engine toggle
        document.getElementById('engine-browser').addEventListener('click', () => this.setSpeechEngine('browser'));
        document.getElementById('engine-vosk').addEventListener('click', () => this.setSpeechEngine('vosk'));

        // Theme toggle
        document.getElementById('theme-dark').addEventListener('click', () => this.setTheme('dark'));
        document.getElementById('theme-light').addEventListener('click', () => this.setTheme('light'));
        document.getElementById('theme-system').addEventListener('click', () => this.setTheme('system'));

        // Highlight color picker
        document.getElementById('highlight-color').addEventListener('input', (e) => {
            this.setHighlightColor(e.target.value);
        });

        // Color presets
        document.querySelectorAll('.color-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.getAttribute('data-color');
                document.getElementById('highlight-color').value = color;
                this.setHighlightColor(color);
            });
        });

        // Import/Export .md files
        document.getElementById('import-md-btn').addEventListener('click', () => {
            document.getElementById('md-file-input').click();
        });
        document.getElementById('md-file-input').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importMarkdown(e.target.files[0]);
                e.target.value = '';
            }
        });
        document.getElementById('export-md-btn').addEventListener('click', () => this.exportMarkdown());
    }

    setMode(mode, save = true) {
        this.mode = mode;
        document.getElementById('mode-voice').classList.toggle('active', mode === 'voice');
        document.getElementById('mode-manual').classList.toggle('active', mode === 'manual');
        if (save) this.safeSetLocalStorage('teleprompter-mode', mode);
    }

    setSpeechEngine(engine, save = true) {
        this.speechEngine = engine;
        document.getElementById('engine-browser').classList.toggle('active', engine === 'browser');
        document.getElementById('engine-vosk').classList.toggle('active', engine === 'vosk');
        document.getElementById('model-group').style.display = engine === 'vosk' ? 'block' : 'none';
        document.getElementById('browser-lang-group').style.display = engine === 'browser' ? 'block' : 'none';

        const hint = document.getElementById('engine-hint');
        if (engine === 'browser') {
            hint.textContent = 'Uses browser speech recognition - works in Chrome/Edge';
        } else {
            hint.textContent = 'Offline recognition - requires backend server';
        }
        if (save) this.safeSetLocalStorage('teleprompter-engine', engine);
    }

    setTheme(theme, save = true) {
        // Store the preference (dark, light, or system)
        this.themePreference = theme;

        // Update button states
        document.getElementById('theme-dark').classList.toggle('active', theme === 'dark');
        document.getElementById('theme-light').classList.toggle('active', theme === 'light');
        document.getElementById('theme-system').classList.toggle('active', theme === 'system');

        // Determine effective theme
        let effectiveTheme = theme;
        if (theme === 'system') {
            // Check system preference
            effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }

        // Apply theme to document
        document.documentElement.setAttribute('data-theme', effectiveTheme);

        if (save) this.safeSetLocalStorage('teleprompter-theme', theme);
    }

    setHighlightColor(color, save = true) {
        // Apply color to CSS custom property
        document.documentElement.style.setProperty('--highlight-color', color);
        if (save) this.safeSetLocalStorage('teleprompter-highlightColor', color);
    }

    importMarkdown(file) {
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (file.size > MAX_SIZE) {
            this.showError(
                'File Too Large',
                'The file you selected is larger than 5MB.',
                'Try a smaller file or copy the text manually instead.'
            );
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            this.scriptInput.value = e.target.result;
        };
        reader.onerror = () => {
            this.showError(
                'Failed to Read File',
                'Could not read the file you selected.',
                'Make sure the file isn\'t corrupted and try again.'
            );
        };
        reader.readAsText(file);
    }

    exportMarkdown() {
        const content = this.scriptInput.value;
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'script.md';
        a.click();
        URL.revokeObjectURL(url);
    }

    toggleShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        modal.classList.toggle('hidden');
    }

    // Auto-advance controls - advances words based on CPM
    startAutoAdvance() {
        if (this.autoAdvanceInterval) return;
        this.isScrollPaused = false;
        this.updateStatus();
        this.scheduleNextAdvance();
    }

    scheduleNextAdvance() {
        if (this.autoAdvanceInterval) {
            clearTimeout(this.autoAdvanceInterval);
        }
        if (!this.isRunning || this.isScrollPaused || this.mode !== 'manual') return;
        if (this.currentWordIndex >= this.scriptWords.length) return;

        const currentWord = this.scriptWords[this.currentWordIndex] || '';
        const delay = this.getWordDelay(currentWord);

        this.autoAdvanceInterval = setTimeout(() => {
            if (!this.isScrollPaused && this.isRunning && this.mode === 'manual') {
                this.advanceWord();
                this.scheduleNextAdvance();
            }
        }, delay);
    }

    // Calculate delay for a word based on length and punctuation
    getWordDelay(word) {
        const charCount = Math.max(word.length, 1);
        const msPerChar = 60000 / this.readingSpeed;
        let delay = charCount * msPerChar;

        // Add pause for punctuation at end of word
        const lastChar = word.slice(-1);
        if ('.!?'.includes(lastChar)) {
            delay += msPerChar * 8; // Sentence-ending pause
        } else if (',;:'.includes(lastChar)) {
            delay += msPerChar * 4; // Clause pause
        } else if ('-–—'.includes(lastChar)) {
            delay += msPerChar * 3; // Dash pause
        }
        return delay;
    }

    // Schedule next advance while holding spacebar
    scheduleHoldAdvance() {
        if (!this.isSpaceHeld || this.currentWordIndex >= this.scriptWords.length) return;

        const currentWord = this.scriptWords[this.currentWordIndex] || '';
        const delay = this.getWordDelay(currentWord);

        this.advanceInterval = setTimeout(() => {
            if (this.isSpaceHeld) {
                this.advanceWord();
                this.scheduleHoldAdvance();
            }
        }, delay);
    }

    stopAutoAdvance() {
        if (this.autoAdvanceInterval) {
            clearTimeout(this.autoAdvanceInterval);
            this.autoAdvanceInterval = null;
        }
    }

    toggleScrollPause() {
        this.isScrollPaused = !this.isScrollPaused;
        this.updateStatus();

        if (!this.isScrollPaused) {
            if (this.mode === 'voice') {
                this.recognitionStatus.textContent = 'Listening...';
            } else {
                this.scheduleNextAdvance();
            }
            this.scrollToCurrentWord();
        }
    }

    adjustSpeed(delta) {
        this.readingSpeed = Math.max(300, Math.min(2000, this.readingSpeed + delta));
        // Sync slider
        document.getElementById('reading-speed').value = this.readingSpeed;
        document.getElementById('speed-value').textContent = `${this.readingSpeed} CPM`;
        this.updateStatus();
    }

    updateStatus() {
        const liveTranscription = document.getElementById('live-transcription');
        const speedIndicator = document.getElementById('speed-indicator');

        speedIndicator.classList.remove('hidden');
        speedIndicator.textContent = this.isScrollPaused ? 'PAUSED' : `${this.readingSpeed} CPM`;
        speedIndicator.classList.toggle('paused', this.isScrollPaused);

        if (this.mode === 'manual') {
            this.recognitionStatus.textContent = '';
            if (liveTranscription) {
                liveTranscription.textContent = 'Hold Space=advance  Ctrl=pause  ↑↓=speed';
            }
        } else {
            if (this.isScrollPaused) {
                this.recognitionStatus.textContent = 'PAUSED - Ctrl to resume';
                if (liveTranscription) {
                    liveTranscription.textContent = '';
                }
            }
        }
    }

    async importPptx(file) {
        const btn = document.getElementById('import-pptx-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Importing...';
        btn.disabled = true;

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/import/pptx', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Import failed');
            }

            const data = await response.json();
            this.scriptInput.value = data.script;
            this.showInfo(
                'PPTX Import Successful',
                `Imported notes from ${data.slideCount} slides.`,
                'Review the imported text and make any needed adjustments before starting.'
            );

        } catch (error) {
            this.showError(
                'PPTX Import Failed',
                'Could not extract notes from the PowerPoint file.',
                'Make sure the file contains speaker notes. Only .pptx files (not .ppt) are supported.'
            );
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }

    updateFullscreenButton() {
        const btn = document.getElementById('fullscreen-btn');
        btn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    }

    showError(title, message, suggestion) {
        this.showModal('error', title, message, suggestion);
    }

    showWarning(title, message, suggestion) {
        this.showModal('warning', title, message, suggestion);
    }

    showInfo(title, message, suggestion) {
        this.showModal('info', title, message, suggestion);
    }

    showModal(type, title, message, suggestion) {
        // Remove existing error modal if any
        const existingModal = document.getElementById('error-modal');
        if (existingModal) existingModal.remove();

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'error-modal';
        modal.className = 'modal';

        const iconMap = {
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const suggestionHtml = suggestion ? `<p class="error-suggestion">${suggestion}</p>` : '';

        modal.innerHTML = `
            <div class="modal-content error-modal-content">
                <div class="error-icon ${type}">${iconMap[type]}</div>
                <h2>${title}</h2>
                <p class="error-message">${message}</p>
                ${suggestionHtml}
                <button class="primary" id="close-error-modal">Got it</button>
            </div>
        `;

        document.body.appendChild(modal);

        // Close on button click
        document.getElementById('close-error-modal').addEventListener('click', () => {
            modal.remove();
        });

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    resetSettings() {
        if (!confirm('Reset all settings to defaults? (Your script will not be cleared)')) {
            return;
        }

        // Clear all teleprompter localStorage keys
        const keysToRemove = [
            'teleprompter-fontSize',
            'teleprompter-scrollMargin',
            'teleprompter-readingSpeed',
            'teleprompter-matchTolerance',
            'teleprompter-mirrorHorizontal',
            'teleprompter-mirrorVertical',
            'teleprompter-showHighlight',
            'teleprompter-mode',
            'teleprompter-engine',
            'teleprompter-theme',
            'teleprompter-highlightColor'
        ];
        keysToRemove.forEach(key => localStorage.removeItem(key));

        // Reset sliders to their HTML default values
        this.fontSizeSlider.value = 48;
        this.scrollMarginSlider.value = 30;
        document.getElementById('reading-speed').value = 900;
        document.getElementById('match-tolerance').value = 100;

        // Reset checkboxes to their HTML default values
        this.mirrorHorizontal.checked = false;
        this.mirrorVertical.checked = false;
        this.showHighlight.checked = true;

        // Reset mode and engine to defaults
        this.setMode('voice', false);
        this.setSpeechEngine('browser', false);

        // Reset theme and highlight color to defaults
        this.setTheme('dark', false);
        document.getElementById('highlight-color').value = '#e94560';
        this.setHighlightColor('#e94560', false);

        // Apply the default settings
        this.applyStoredSettings();

        this.showInfo(
            'Settings Reset',
            'All settings have been reset to their default values.',
            'Your script text has been preserved.'
        );
    }

    async loadModels() {
        const voskBtn = document.getElementById('engine-vosk');
        const browserBtn = document.getElementById('engine-browser');

        // Check browser speech support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            browserBtn.disabled = true;
            browserBtn.title = 'Not supported in this browser';
            browserBtn.textContent = 'Browser (unsupported)';
        }

        // Check Vosk backend
        try {
            const response = await fetch('/api/models');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();

            this.modelSelect.innerHTML = '';

            if (!data.models || data.models.length === 0) {
                this.modelSelect.innerHTML = '<option value="">No models found</option>';
                voskBtn.disabled = true;
                voskBtn.title = 'No models available';
                voskBtn.textContent = 'Vosk (no models)';
            } else {
                data.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.path;
                    option.textContent = `${model.language.toUpperCase()} - ${model.name}`;
                    this.modelSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Failed to load models:', error);
            this.modelSelect.innerHTML = '<option value="">Vosk backend not available</option>';
            voskBtn.disabled = true;
            voskBtn.title = 'Backend not available';
            voskBtn.textContent = 'Vosk (offline)';
        }

        // If current selection is disabled, switch to the other
        if (this.speechEngine === 'vosk' && voskBtn.disabled && !browserBtn.disabled) {
            this.setSpeechEngine('browser');
        } else if (this.speechEngine === 'browser' && browserBtn.disabled && !voskBtn.disabled) {
            this.setSpeechEngine('vosk');
        }
    }

    async checkUrlForScript() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('s');
        if (code) {
            await this.loadScript(code);
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    async saveScript() {
        const script = this.scriptInput.value.trim();
        if (!script) {
            this.showError(
                'No Script to Save',
                'Please enter your script before saving.',
                'Type or paste your script in the text box above.'
            );
            return;
        }

        try {
            const response = await fetch('/api/scripts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    script: script,
                    language: this.modelSelect.value,
                    fontSize: parseInt(this.fontSizeSlider.value),
                    scrollMargin: parseInt(this.scrollMarginSlider.value)
                })
            });

            const data = await response.json();
            const code = data.code;
            const url = `${window.location.origin}?s=${code}`;

            // Update modal
            document.getElementById('save-code').textContent = code;
            document.getElementById('save-url').value = url;

            // Generate QR code
            const qrDiv = document.getElementById('qr-code');
            qrDiv.innerHTML = '';
            if (typeof qrcode !== 'undefined') {
                const qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                qrDiv.innerHTML = qr.createImgTag(5);
            }

            this.saveModal.classList.remove('hidden');
        } catch (error) {
            console.error('Save failed:', error);
            this.showError(
                'Save Failed',
                'Could not save your script to the server.',
                'The server might be down or your connection was lost. Try saving again in a moment.'
            );
        }
    }

    showLoadModal() {
        document.getElementById('load-code-input').value = '';
        document.getElementById('load-error').classList.add('hidden');
        this.loadModal.classList.remove('hidden');
        document.getElementById('load-code-input').focus();
    }

    async loadScript(code) {
        try {
            const response = await fetch(`/api/scripts/${code}`);
            if (!response.ok) {
                throw new Error('Script not found');
            }

            const data = await response.json();

            // Apply loaded data
            this.scriptInput.value = data.script;

            if (data.fontSize) {
                this.fontSizeSlider.value = data.fontSize;
                this.fontSizeValue.textContent = `${data.fontSize}px`;
            }

            if (data.scrollMargin) {
                this.scrollMarginSlider.value = data.scrollMargin;
                this.scrollMarginValue.textContent = `${data.scrollMargin}%`;
                this.scrollMarginPercent = data.scrollMargin;
            }

            // Try to select matching language
            if (data.language) {
                for (const option of this.modelSelect.options) {
                    if (option.value === data.language) {
                        option.selected = true;
                        break;
                    }
                }
            }

            this.loadModal.classList.add('hidden');
        } catch (error) {
            this.showError(
                'Script Not Found',
                `No script exists with code "${code}".`,
                'Scripts expire after 30 days. Check if you entered the code correctly, or save your script again.'
            );
        }
    }

    connectWebSocket() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.connectionStatus.textContent = 'Connected';
                this.connectionStatus.className = 'connected';
                resolve();
            };

            this.ws.onclose = () => {
                this.connectionStatus.textContent = 'Disconnected';
                this.connectionStatus.className = 'disconnected';
                if (this.isRunning) {
                    this.stop();
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('Invalid JSON from server:', e);
                }
            };
        });
    }

    handleMessage(data) {
        const liveTranscription = document.getElementById('live-transcription');

        switch (data.type) {
            case 'ready':
                this.recognitionStatus.textContent = 'Listening...';
                break;

            case 'stopped':
                this.recognitionStatus.textContent = '';
                if (liveTranscription) liveTranscription.textContent = '';
                break;

            case 'error':
                console.error('Server error:', data.message);
                this.showError(
                    'Server Error',
                    data.message || 'An error occurred while processing audio.',
                    'Try restarting the teleprompter or check the backend server logs.'
                );
                break;

            case 'partial':
                // Show live transcription
                if (liveTranscription && data.text) {
                    liveTranscription.textContent = `"${data.text}"`;
                    liveTranscription.style.opacity = '0.7';
                }
                if (this.isRunning && data.words) {
                    this.matchWords(data.words);
                }
                break;

            case 'final':
                // Show confirmed transcription
                if (liveTranscription && data.text) {
                    liveTranscription.textContent = `"${data.text}"`;
                    liveTranscription.style.opacity = '1';
                }
                if (this.isRunning && data.words) {
                    this.matchWords(data.words);
                }
                break;
        }
    }

    async startAudioCapture(modelPath) {
        // Request microphone access
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });
        } catch (micError) {
            throw micError;
        }

        // Create audio context (browser will use its preferred sample rate)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();

        // Resume audio context (required by some browsers)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        const inputSampleRate = this.audioContext.sampleRate;
        const targetSampleRate = 16000;

        // Use AnalyserNode for level monitoring (more reliable)
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);

        // Create script processor for sending audio
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

        // Connect source -> processor -> destination (required for processor to work)
        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);

        // Start level monitoring (clear any existing first)
        if (this.levelInterval) {
            clearInterval(this.levelInterval);
        }
        this.levelInterval = setInterval(() => {
            if (!this.analyser) return;
            const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            const level = Math.min(100, Math.round(avg * 100 / 255));

            const liveTranscription = document.getElementById('live-transcription');
            if (liveTranscription && !liveTranscription.textContent.startsWith('"')) {
                const bars = '|'.repeat(Math.ceil(level / 10)) || '.';
                liveTranscription.textContent = `Mic: ${bars} (${level}%)`;
            }
        }, 100);

        this.processor.onaudioprocess = (e) => {
            if (!this.isRunning || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            const inputData = e.inputBuffer.getChannelData(0);

            // Resample to 16kHz
            let samples;
            if (inputSampleRate !== targetSampleRate) {
                samples = this.resample(inputData, inputSampleRate, targetSampleRate);
            } else {
                samples = inputData;
            }

            // Convert float32 [-1, 1] to int16 [-32768, 32767]
            const pcmData = new Int16Array(samples.length);
            for (let i = 0; i < samples.length; i++) {
                let s = samples[i];
                s = Math.max(-1, Math.min(1, s));
                pcmData[i] = s < 0 ? s * 32768 : s * 32767;
            }

            // Send binary audio data
            this.ws.send(pcmData.buffer);
        };

        // Tell server to start recognition
        this.ws.send(JSON.stringify({
            type: 'start',
            model: modelPath
        }));
    }

    resample(inputBuffer, inputRate, outputRate) {
        // Simple linear interpolation resampling
        const ratio = inputRate / outputRate;
        const outputLength = Math.floor(inputBuffer.length / ratio);
        const output = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, inputBuffer.length - 1);
            const frac = srcIndex - srcIndexFloor;

            output[i] = inputBuffer[srcIndexFloor] * (1 - frac) + inputBuffer[srcIndexCeil] * frac;
        }

        return output;
    }

    stopAudioCapture() {
        if (this.levelInterval) {
            clearInterval(this.levelInterval);
            this.levelInterval = null;
        }

        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Tell server to stop
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'stop' }));
        }
    }

    // WebSpeech API recognition
    async startWebSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            throw { name: 'NotSupportedError', message: 'Speech recognition not supported' };
        }

        this.webSpeechRecognition = new SpeechRecognition();
        this.webSpeechRecognition.continuous = true;
        this.webSpeechRecognition.interimResults = true;
        this.webSpeechRecognition.lang = document.getElementById('browser-lang').value;

        this.webSpeechRecognition.onresult = (event) => {
            if (!this.isRunning || this.isScrollPaused) return;

            // Get latest results
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const words = transcript.trim().split(/\s+/);

                // Update live transcription
                const liveTranscription = document.getElementById('live-transcription');
                if (liveTranscription) {
                    liveTranscription.textContent = transcript;
                }

                // Match words
                if (words.length > 0) {
                    this.matchWords(words);
                }
            }
        };

        this.webSpeechRecognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'not-allowed') {
                this.recognitionStatus.textContent = 'Microphone access denied';
                this.showError(
                    'Microphone Access Required',
                    'The teleprompter needs microphone access to track your speech.',
                    'Click the 🔒 icon in your browser\'s address bar and allow microphone access, then restart.'
                );
            } else if (event.error === 'no-speech') {
                // Restart on no-speech
                if (this.isRunning) {
                    this.webSpeechRecognition.start();
                }
            } else if (event.error === 'network') {
                this.recognitionStatus.textContent = 'Speech recognition offline';
                // Only show warning once
                if (!this.networkErrorShown) {
                    this.showWarning(
                        'Voice Recognition Unavailable',
                        'Browser speech recognition requires internet access.',
                        'Check your connection or switch to Vosk (offline) mode in settings.'
                    );
                    this.networkErrorShown = true;
                }
            } else {
                this.recognitionStatus.textContent = `Error: ${event.error}`;
            }
        };

        this.webSpeechRecognition.onend = () => {
            // Auto-restart if still running
            if (this.isRunning && !this.isScrollPaused) {
                try {
                    this.webSpeechRecognition.start();
                } catch (e) {
                    // Already started
                }
            }
        };

        this.webSpeechRecognition.start();
        this.recognitionStatus.textContent = 'Listening...';
    }

    stopWebSpeechRecognition() {
        if (this.webSpeechRecognition) {
            this.webSpeechRecognition.onend = null; // Prevent auto-restart
            this.webSpeechRecognition.stop();
            this.webSpeechRecognition = null;
        }
    }

    matchWords(spokenWords) {
        const searchStart = this.currentWordIndex;
        const searchEnd = Math.min(this.currentWordIndex + 15, this.scriptWords.length);

        // Try to find 2 consecutive matching words for reliable advancement
        // Search in progressive pairs: [0,1], [2,3], [4,5]... to prioritize proximity
        const windowSize = searchEnd - searchStart;

        for (let pairIndex = 0; pairIndex < Math.floor(windowSize / 2); pairIndex++) {
            const i = searchStart + (pairIndex * 2);

            if (i >= searchEnd - 1) break;

            const scriptWord1 = this.normalizeWord(this.scriptWords[i]);
            const scriptWord2 = this.normalizeWord(this.scriptWords[i + 1]);

            // Look for consecutive match in spoken words
            for (let j = 0; j < spokenWords.length - 1; j++) {
                const spoken1 = this.normalizeWord(spokenWords[j]);
                const spoken2 = this.normalizeWord(spokenWords[j + 1]);

                if (this.wordsMatch(spoken1, scriptWord1) && this.wordsMatch(spoken2, scriptWord2)) {
                    // Found 2 consecutive matches - advance to after the match
                    for (let k = this.currentWordIndex; k <= i + 1; k++) {
                        this.markWordAsSpoken(k);
                    }
                    this.currentWordIndex = i + 2;
                    this.updateProgress();
                    this.scrollToCurrentWord();
                    return; // Immediate return on first match
                }
            }
        }

        // Handle final position if window size is odd
        if (windowSize % 2 === 1 && windowSize > 1) {
            const finalPos = searchEnd - 2;

            const scriptWord1 = this.normalizeWord(this.scriptWords[finalPos]);
            const scriptWord2 = this.normalizeWord(this.scriptWords[finalPos + 1]);

            for (let j = 0; j < spokenWords.length - 1; j++) {
                const spoken1 = this.normalizeWord(spokenWords[j]);
                const spoken2 = this.normalizeWord(spokenWords[j + 1]);

                if (this.wordsMatch(spoken1, scriptWord1) && this.wordsMatch(spoken2, scriptWord2)) {
                    for (let k = this.currentWordIndex; k <= finalPos + 1; k++) {
                        this.markWordAsSpoken(k);
                    }
                    this.currentWordIndex = finalPos + 2;
                    this.updateProgress();
                    this.scrollToCurrentWord();
                    return;
                }
            }
        }

        // Fallback: single word match only for the immediate next word (no skipping)
        if (spokenWords.length > 0 && this.currentWordIndex < this.scriptWords.length) {
            const nextWord = this.normalizeWord(this.scriptWords[this.currentWordIndex]);
            for (const spoken of spokenWords) {
                if (this.wordsMatch(this.normalizeWord(spoken), nextWord)) {
                    this.markWordAsSpoken(this.currentWordIndex);
                    this.currentWordIndex++;
                    this.updateProgress();
                    this.scrollToCurrentWord();
                    return;
                }
            }
        }
    }

    normalizeWord(word) {
        return word.toLowerCase().replace(/[^\w\s]|_/g, '').trim();
    }

    wordsMatch(spoken, script) {
        if (spoken === script) return true;

        // At 100% tolerance, require exact match
        if (this.matchTolerance >= 100) return false;

        // Short words need exact match
        if (spoken.length < 2 || script.length < 2) {
            return spoken === script;
        }

        // Calculate Levenshtein distance
        const distance = this.levenshtein(spoken, script);
        const maxLen = Math.max(spoken.length, script.length);
        const similarity = ((maxLen - distance) / maxLen) * 100;

        return similarity >= this.matchTolerance;
    }

    levenshtein(a, b) {
        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b[i - 1] === a[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    markWordAsSpoken(index) {
        if (index < this.wordElements.length) {
            this.wordElements[index].classList.add('spoken');
            this.wordElements[index].classList.remove('current');
        }

        if (index + 1 < this.wordElements.length) {
            this.wordElements[index + 1].classList.add('current');
        }

    }

    advanceWord() {
        if (this.currentWordIndex >= this.scriptWords.length) return;
        this.markWordAsSpoken(this.currentWordIndex);
        this.currentWordIndex++;
        this.updateProgress();
        this.scrollToCurrentWord();
    }

    jumpToNextLine() {
        // Find next line start after current position
        const nextLineStart = this.lineStartIndices.find(idx => idx > this.currentWordIndex);
        if (nextLineStart !== undefined) {
            // Mark all words up to the new line as spoken
            for (let i = this.currentWordIndex; i < nextLineStart; i++) {
                this.markWordAsSpoken(i);
            }
            this.currentWordIndex = nextLineStart;
            this.updateProgress();
            this.scrollToCurrentWord();
        }
    }

    handleCueInput(digit) {
        // Clear existing timeout
        if (this.cueInputTimeout) {
            clearTimeout(this.cueInputTimeout);
        }

        // Add digit to buffer
        this.cueInputBuffer += digit;

        // Show current input in status
        this.recognitionStatus.textContent = `Cue: ${this.cueInputBuffer}`;

        // Set timeout to execute jump
        this.cueInputTimeout = setTimeout(() => {
            const cueNumber = parseInt(this.cueInputBuffer);
            this.cueInputBuffer = '';

            const cuePoint = this.cuePoints[cueNumber];
            if (cuePoint !== undefined) {
                this.jumpToWord(cuePoint.wordIndex);

                // Scroll to show the cue point separator at the top
                if (cuePoint.element) {
                    const container = document.getElementById('teleprompter-content');
                    const targetOffset = container.clientHeight * (this.scrollMarginPercent / 100);
                    const scrollTarget = cuePoint.element.offsetTop - targetOffset;
                    container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                }

                // Auto-pause so presenter can settle
                if (!this.isScrollPaused) {
                    this.toggleScrollPause();
                }
                this.recognitionStatus.textContent = `→ [${cueNumber}] PAUSED`;
            } else {
                this.recognitionStatus.textContent = `[${cueNumber}] not found`;
                // Clear "not found" after a moment
                setTimeout(() => {
                    if (this.isRunning) {
                        this.recognitionStatus.textContent = this.isScrollPaused ? 'PAUSED' : '';
                    }
                }, 1500);
            }
        }, 1000); // 1 second window
    }

    scrollToCurrentWord() {
        // Don't auto-scroll when paused (allows manual intervention)
        if (this.isScrollPaused) return;
        if (this.currentWordIndex >= this.wordElements.length) return;

        const currentElement = this.wordElements[this.currentWordIndex];
        if (!currentElement) return;

        const container = document.getElementById('teleprompter-content');
        const containerHeight = container.clientHeight;
        const targetOffset = containerHeight * (this.scrollMarginPercent / 100);

        const elementTop = currentElement.offsetTop;
        const scrollTarget = elementTop - targetOffset;

        // Start smooth animation toward target
        this.animateScrollTo(container, scrollTarget);
    }

    animateScrollTo(container, target) {
        // Cancel any existing animation
        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
        }

        const animate = () => {
            if (this.isScrollPaused) return;

            const current = container.scrollTop;
            const distance = target - current;

            // If close enough, snap to target and stop
            if (Math.abs(distance) < 3) {
                container.scrollTop = target;
                this.scrollAnimationId = null;
                return;
            }

            // Quick easing - move 25% of remaining distance per frame
            // with minimum step to avoid slow creeping
            const minStep = 3;
            let step = distance * 0.25;

            // Enforce minimum step size (in the right direction)
            if (Math.abs(step) < minStep) {
                step = distance > 0 ? minStep : -minStep;
            }

            container.scrollTop = current + step;

            this.scrollAnimationId = requestAnimationFrame(animate);
        };

        this.scrollAnimationId = requestAnimationFrame(animate);
    }

    updateProgress() {
        this.progressIndicator.textContent = `${this.currentWordIndex} / ${this.scriptWords.length}`;
    }

    updateMirror() {
        const transforms = [];
        if (this.mirrorHorizontal.checked) {
            transforms.push('scaleX(-1)');
        }
        if (this.mirrorVertical.checked) {
            transforms.push('scaleY(-1)');
        }
        this.teleprompterView.style.transform = transforms.join(' ');
    }

    async start() {
        const script = this.scriptInput.value.trim();
        if (!script) {
            this.showError(
                'No Script Found',
                'Please enter or paste your script in the text box above before starting.',
                'Try pasting some text or use "Import PPTX" to load notes from a presentation.'
            );
            return;
        }

        // Build display (also parses scriptWords)
        this.currentWordIndex = 0;
        this.buildScriptDisplay();

        // Voice mode requires microphone
        if (this.mode === 'voice') {
            try {
                if (this.speechEngine === 'browser') {
                    // Use browser WebSpeech API
                    this.connectionStatus.textContent = 'Browser';
                    this.recognitionStatus.textContent = 'Starting...';
                    await this.startWebSpeechRecognition();
                } else {
                    // Use Vosk backend
                    const modelPath = this.modelSelect.value;
                    if (!modelPath) {
                        this.showError(
                            'No Model Selected',
                            'Please select a language model from the dropdown.',
                            'Choose a model that matches the language you\'ll be speaking.'
                        );
                        return;
                    }

                    // Connect WebSocket
                    this.connectionStatus.textContent = 'Connecting...';
                    await this.connectWebSocket();

                    // Start audio capture and recognition
                    this.recognitionStatus.textContent = 'Starting microphone...';
                    await this.startAudioCapture(modelPath);
                }
            } catch (error) {
                console.error('Start error:', error);
                this.stopAudioCapture();
                this.stopWebSpeechRecognition();

                if (error?.name === 'NotAllowedError') {
                    this.showError(
                        'Microphone Access Required',
                        'The teleprompter needs microphone access to track your speech.',
                        'Click the 🔒 icon in your browser\'s address bar and allow microphone access, then try again.'
                    );
                } else if (error?.name === 'NotFoundError') {
                    this.showError(
                        'No Microphone Detected',
                        'Your device doesn\'t have a microphone connected.',
                        'Connect a microphone or use Manual Scroll mode instead (under Scroll Mode settings).'
                    );
                } else if (error?.name === 'NotSupportedError') {
                    this.showError(
                        'Browser Not Supported',
                        'Voice recognition isn\'t available in this browser.',
                        'Try using Chrome or Edge for voice mode, or switch to Manual Scroll mode which works in all browsers.'
                    );
                } else {
                    this.showError(
                        'Failed to Start',
                        error?.message || 'An unknown error occurred while starting the teleprompter.',
                        'Try refreshing the page or check the browser console for more details.'
                    );
                }
                return;
            }
        } else {
            // Manual mode - start auto-advance
            this.connectionStatus.textContent = 'Manual';
            this.startAutoAdvance();
            this.updateStatus();
        }

        // Switch to teleprompter view
        this.setupPanel.classList.add('hidden');
        this.teleprompterView.classList.remove('hidden');
        this.isRunning = true;

        // Auto-enter fullscreen on presentation start
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
        this.updateProgress();
        this.updateMirror();

        // Show mode indicator
        const langIndicator = document.getElementById('language-indicator');
        if (this.mode === 'voice') {
            if (this.speechEngine === 'browser') {
                const lang = document.getElementById('browser-lang').value;
                langIndicator.textContent = lang.split('-')[0].toUpperCase();
            } else {
                const selectedOption = this.modelSelect.options[this.modelSelect.selectedIndex];
                if (selectedOption) {
                    const langMatch = selectedOption.textContent.match(/^([A-Z-]+)/i);
                    langIndicator.textContent = langMatch ? langMatch[1] : 'Unknown';
                }
            }
        } else {
            langIndicator.textContent = 'MANUAL';
        }

        if (this.wordElements.length > 0) {
            this.wordElements[0].classList.add('current');
        }

        // Scroll to top on start
        document.getElementById('teleprompter-content').scrollTop = 0;

        // Apply highlight preference
        if (this.showHighlight.checked) {
            this.scriptDisplay.classList.remove('no-highlight');
        } else {
            this.scriptDisplay.classList.add('no-highlight');
        }
    }

    buildScriptDisplay() {
        this.scriptDisplay.innerHTML = '';
        this.wordElements = [];
        this.scriptWords = [];
        this.lineStartIndices = [0]; // First line always starts at index 0
        this.cuePoints = {}; // Reset cue points

        const script = this.scriptInput.value.trim();

        // Parse script, handling [cues] and {notes} specially
        // Split on [cues], {notes}, while keeping delimiters
        const parts = script.split(/(\[[^\]]+\]|\{[^}]+\})/g);

        let wordIndex = 0;
        parts.forEach(part => {
            if (!part.trim()) return;

            if (part.startsWith('[') && part.endsWith(']')) {
                const content = part.slice(1, -1).trim();

                // Check if this is a numbered cue point [1], [15], etc.
                if (/^\d+$/.test(content)) {
                    const cueNumber = parseInt(content);

                    // Create visual separator for cue point
                    const cueDiv = document.createElement('div');
                    cueDiv.className = 'cue-point';
                    cueDiv.innerHTML = `<span class="cue-number">${cueNumber}</span>`;
                    this.scriptDisplay.appendChild(cueDiv);

                    // Store both word index and element reference
                    this.cuePoints[cueNumber] = { wordIndex, element: cueDiv };
                    return;
                }

                // Regular cue/instruction - display but don't match
                const span = document.createElement('span');
                span.className = 'cue';
                span.textContent = part;
                this.scriptDisplay.appendChild(span);
                this.scriptDisplay.appendChild(document.createTextNode(' '));

            } else if (part.startsWith('{') && part.endsWith('}')) {
                // This is a notes section - display as card, click to advance
                const content = part.slice(1, -1).trim();
                const notesDiv = document.createElement('div');
                notesDiv.className = 'notes-section';
                notesDiv.dataset.index = wordIndex;

                const label = document.createElement('span');
                label.className = 'notes-label';
                label.textContent = 'NOTES';
                notesDiv.appendChild(label);

                const text = document.createElement('div');
                text.className = 'notes-content';
                text.textContent = content;
                notesDiv.appendChild(text);

                const hint = document.createElement('div');
                hint.className = 'notes-hint';
                hint.textContent = '(click when done)';
                notesDiv.appendChild(hint);

                // Click to mark as done and continue
                notesDiv.addEventListener('click', () => {
                    notesDiv.classList.add('spoken');
                    // Find next word after this notes section and jump there
                    const nextIndex = parseInt(notesDiv.dataset.nextIndex);
                    if (nextIndex !== undefined && !isNaN(nextIndex)) {
                        this.currentWordIndex = nextIndex;
                        this.updateProgress();
                        if (this.wordElements[nextIndex]) {
                            this.wordElements[nextIndex].classList.add('current');
                            this.scrollToCurrentWord();
                                            }
                    }
                });

                this.scriptDisplay.appendChild(notesDiv);

                // Store a placeholder so word indexing stays correct
                this.wordElements.push(notesDiv);
                this.scriptWords.push('__NOTES__');
                notesDiv.dataset.nextIndex = wordIndex + 1;
                wordIndex++;

            } else {
                // Regular words - parse for emphasis (*word* and **word**)
                // Process line by line to track line boundaries
                const lines = part.split('\n');

                lines.forEach((line, lineIdx) => {
                    // Record line start (except for first line of first part)
                    if (lineIdx > 0 && wordIndex > 0) {
                        this.lineStartIndices.push(wordIndex);
                    }

                    // Tokenize this line to handle multi-word emphasis spans
                    const tokens = [];
                    let remaining = line;

                    // Match emphasis spans (multi-word or single-word)
                    const emphasisRegex = /(\*\*(.+?)\*\*|\*([^*]+?)\*)/g;
                    let lastIndex = 0;
                    let match;

                    while ((match = emphasisRegex.exec(remaining)) !== null) {
                        // Add plain text before this match
                        if (match.index > lastIndex) {
                            const plainText = remaining.slice(lastIndex, match.index);
                            plainText.split(/\s+/).filter(w => w.length > 0).forEach(w => {
                                tokens.push({ word: w, emphasis: null });
                            });
                        }

                        // Add emphasized words
                        const isStrong = match[0].startsWith('**');
                        const innerText = isStrong ? match[2] : match[3];
                        innerText.split(/\s+/).filter(w => w.length > 0).forEach(w => {
                            tokens.push({ word: w, emphasis: isStrong ? 'strong' : 'emphasis' });
                        });

                        lastIndex = match.index + match[0].length;
                    }

                    // Add remaining plain text
                    if (lastIndex < remaining.length) {
                        remaining.slice(lastIndex).split(/\s+/).filter(w => w.length > 0).forEach(w => {
                            tokens.push({ word: w, emphasis: null });
                        });
                    }

                    // Create spans for each token
                    tokens.forEach(token => {
                        const span = document.createElement('span');
                        span.className = 'word';
                        span.dataset.index = wordIndex;

                        if (token.emphasis === 'strong') {
                            span.classList.add('strong-emphasis');
                        } else if (token.emphasis === 'emphasis') {
                            span.classList.add('emphasis');
                        }

                        span.textContent = token.word;

                        span.addEventListener('click', () => {
                            this.jumpToWord(parseInt(span.dataset.index));
                        });

                        this.scriptDisplay.appendChild(span);
                        this.scriptDisplay.appendChild(document.createTextNode(' '));
                        this.wordElements.push(span);
                        this.scriptWords.push(token.word); // Store without markers for matching
                        wordIndex++;
                    });
                });
            }
        });
    }

    jumpToWord(index) {
        for (let i = index; i < this.wordElements.length; i++) {
            this.wordElements[i].classList.remove('spoken', 'current');
        }

        for (let i = 0; i < index; i++) {
            this.wordElements[i].classList.add('spoken');
            this.wordElements[i].classList.remove('current');
        }

        this.currentWordIndex = index;
        if (this.wordElements[index]) {
            this.wordElements[index].classList.add('current');
        }

        this.updateProgress();
        this.scrollToCurrentWord();
    }

    stop() {
        this.isRunning = false;
        this.stopAudioCapture();
        this.stopWebSpeechRecognition();
        this.stopAutoAdvance();

        // Clear hold-to-advance state
        this.isSpaceHeld = false;
        if (this.advanceInterval) {
            clearTimeout(this.advanceInterval);
            this.advanceInterval = null;
        }

        // Cancel scroll animation
        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
            this.scrollAnimationId = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen();
        }

        this.teleprompterView.classList.add('hidden');
        this.setupPanel.classList.remove('hidden');
        this.teleprompterView.style.transform = '';
    }

    restart() {
        this.wordElements.forEach(el => {
            el.classList.remove('spoken', 'current');
        });

        this.currentWordIndex = 0;
        this.updateProgress();

        if (this.wordElements.length > 0) {
            this.wordElements[0].classList.add('current');
        }

        document.getElementById('teleprompter-content').scrollTo({ top: 0, behavior: 'smooth' });

        // Resume auto-advance if paused
        if (this.mode === 'manual') {
            this.isScrollPaused = false;
            this.updateStatus();
            this.scheduleNextAdvance();
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.teleprompter = new Teleprompter();
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
            .then((reg) => console.log('SW registered:', reg.scope))
            .catch((err) => console.log('SW registration failed:', err));
    });
}
