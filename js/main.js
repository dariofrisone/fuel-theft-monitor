/**
 * Main entry point for Fuel Theft Monitor Add-in
 * Handles add-in lifecycle and UI initialization
 */

(function() {
    'use strict';

    // Geotab API instance
    let api = null;
    let state = null;

    // Settings modal elements
    let settingsModal = null;
    let settingsBtn = null;
    let closeSettingsBtn = null;
    let saveSettingsBtn = null;
    let cancelSettingsBtn = null;

    /**
     * Entry point for the add-in
     * Called by MyGeotab when the add-in is loaded
     */
    window.geotab = window.geotab || {};
    window.geotab.addin = window.geotab.addin || {};

    window.geotab.addin.fuelTheftMonitor = function() {
        return {
            /**
             * Initialize the add-in
             * @param {Object} freshApi - Geotab API instance
             * @param {Object} freshState - Add-in state
             * @param {Function} callback - Callback when initialization is complete
             */
            initialize: function(freshApi, freshState, callback) {
                api = freshApi;
                state = freshState;

                console.log('Fuel Theft Monitor initializing...');

                // Initialize UI components
                initializeUI();

                // Initialize alert manager
                AlertManager.init();

                // Initialize fuel monitor with API
                FuelMonitor.init(api);

                // Request notification permission
                requestNotificationPermission();

                // Load saved settings into UI
                loadSettingsToUI();

                callback();
            },

            /**
             * Called when the add-in gains focus (user navigates to it)
             * @param {Object} freshApi - Geotab API instance
             * @param {Object} freshState - Add-in state
             */
            focus: function(freshApi, freshState) {
                api = freshApi;
                state = freshState;

                console.log('Fuel Theft Monitor focused');

                // Start monitoring when add-in is active
                FuelMonitor.startMonitoring();
            },

            /**
             * Called when the add-in loses focus (user navigates away)
             */
            blur: function() {
                console.log('Fuel Theft Monitor blurred');

                // Optionally stop monitoring when not visible
                // Uncomment if you want to save resources:
                // FuelMonitor.stopMonitoring();
            }
        };
    };

    /**
     * Initialize UI event handlers
     */
    function initializeUI() {
        // Cache modal elements
        settingsModal = document.getElementById('settings-modal');
        settingsBtn = document.getElementById('settings-btn');
        closeSettingsBtn = document.getElementById('close-settings');
        saveSettingsBtn = document.getElementById('save-settings');
        cancelSettingsBtn = document.getElementById('cancel-settings');

        // Settings button click
        if (settingsBtn) {
            settingsBtn.addEventListener('click', openSettings);
        }

        // Close settings
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', closeSettings);
        }

        // Cancel settings
        if (cancelSettingsBtn) {
            cancelSettingsBtn.addEventListener('click', closeSettings);
        }

        // Save settings
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', saveSettings);
        }

        // Close modal on backdrop click
        if (settingsModal) {
            settingsModal.addEventListener('click', function(e) {
                if (e.target === settingsModal) {
                    closeSettings();
                }
            });
        }

        // Keyboard handling
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && settingsModal.classList.contains('active')) {
                closeSettings();
            }
        });
    }

    /**
     * Open settings modal
     */
    function openSettings() {
        loadSettingsToUI();
        settingsModal.classList.add('active');
    }

    /**
     * Close settings modal
     */
    function closeSettings() {
        settingsModal.classList.remove('active');
    }

    /**
     * Save settings from modal
     */
    function saveSettings() {
        const threshold = parseInt(document.getElementById('threshold-input').value, 10);
        const timeWindow = parseInt(document.getElementById('time-window-input').value, 10);
        const pollInterval = parseInt(document.getElementById('poll-interval-input').value, 10);
        const soundEnabled = document.getElementById('sound-enabled').checked;
        const browserNotifications = document.getElementById('browser-notifications').checked;

        // Validate inputs
        if (isNaN(threshold) || threshold < 1 || threshold > 50) {
            alert('Threshold must be between 1 and 50');
            return;
        }

        if (isNaN(timeWindow) || timeWindow < 5 || timeWindow > 120) {
            alert('Time window must be between 5 and 120 minutes');
            return;
        }

        if (isNaN(pollInterval) || pollInterval < 10 || pollInterval > 300) {
            alert('Polling interval must be between 10 and 300 seconds');
            return;
        }

        // Update fuel monitor config
        FuelMonitor.updateConfig({
            dropThreshold: threshold,
            timeWindowMinutes: timeWindow,
            pollIntervalSeconds: pollInterval
        });

        // Save notification preferences
        const notificationSettings = {
            soundEnabled: soundEnabled,
            browserNotifications: browserNotifications
        };

        try {
            localStorage.setItem('fuelMonitorSettings', JSON.stringify(notificationSettings));
        } catch (e) {
            console.error('Failed to save notification settings:', e);
        }

        closeSettings();
        console.log('Settings saved');
    }

    /**
     * Load settings into UI inputs
     */
    function loadSettingsToUI() {
        // Load fuel monitor config
        const config = FuelMonitor.getConfig();

        const thresholdInput = document.getElementById('threshold-input');
        const timeWindowInput = document.getElementById('time-window-input');
        const pollIntervalInput = document.getElementById('poll-interval-input');

        if (thresholdInput) thresholdInput.value = config.dropThreshold;
        if (timeWindowInput) timeWindowInput.value = config.timeWindowMinutes;
        if (pollIntervalInput) pollIntervalInput.value = config.pollIntervalSeconds;

        // Load notification settings
        try {
            const notifSettings = JSON.parse(localStorage.getItem('fuelMonitorSettings')) || {};

            const soundEnabled = document.getElementById('sound-enabled');
            const browserNotifications = document.getElementById('browser-notifications');

            if (soundEnabled) {
                soundEnabled.checked = notifSettings.soundEnabled !== false;
            }
            if (browserNotifications) {
                browserNotifications.checked = notifSettings.browserNotifications !== false;
            }
        } catch (e) {
            console.error('Failed to load notification settings:', e);
        }
    }

    /**
     * Request browser notification permission
     */
    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(function(permission) {
                console.log('Notification permission:', permission);
            });
        }
    }

    /**
     * For standalone testing (without MyGeotab)
     * Creates a mock API for development
     */
    function initializeStandalone() {
        console.log('Running in standalone mode');

        // Mock API for testing
        const mockApi = {
            call: function(method, params) {
                console.log('Mock API call:', method, params);
                return Promise.resolve([]);
            }
        };

        // Initialize components
        AlertManager.init();
        FuelMonitor.init(mockApi);
        initializeUI();
        loadSettingsToUI();

        // Update status for standalone mode
        const indicator = document.getElementById('status-indicator');
        if (indicator) {
            indicator.className = 'status-indicator status-active';
            indicator.querySelector('.status-text').textContent = 'Demo Mode';
        }

        // Add demo alert for testing
        setTimeout(function() {
            AlertManager.addAlert({
                vehicleId: 'demo-1',
                vehicleName: 'Demo Vehicle #1',
                severity: 'high',
                fuelDrop: 18.5,
                previousLevel: 75.0,
                currentLevel: 56.5,
                duration: 15,
                location: 'Demo Location'
            });
        }, 2000);
    }

    // Check if running inside MyGeotab or standalone
    document.addEventListener('DOMContentLoaded', function() {
        // If not in MyGeotab, initialize standalone mode
        if (typeof window.geotab === 'undefined' || !window.geotab.addin) {
            initializeStandalone();
        }
    });
})();
