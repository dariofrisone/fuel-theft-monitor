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

        // Test alert button
        const testAlertBtn = document.getElementById('test-alert-btn');
        if (testAlertBtn) {
            testAlertBtn.addEventListener('click', triggerTestAlert);
        }

        // Analyze history button
        const analyzeHistoryBtn = document.getElementById('analyze-history-btn');
        if (analyzeHistoryBtn) {
            analyzeHistoryBtn.addEventListener('click', analyzeHistoricalData);
        }

        // Set default dates (last 7 days)
        setDefaultDates();
    }

    /**
     * Set default date range (last 7 days)
     */
    function setDefaultDates() {
        const dateFrom = document.getElementById('date-from');
        const dateTo = document.getElementById('date-to');

        if (dateFrom && dateTo) {
            const today = new Date();
            const weekAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));

            dateTo.value = today.toISOString().split('T')[0];
            dateFrom.value = weekAgo.toISOString().split('T')[0];
        }
    }

    /**
     * Analyze historical fuel data for selected date range
     */
    async function analyzeHistoricalData() {
        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');
        const analyzeBtn = document.getElementById('analyze-history-btn');

        if (!dateFromInput.value || !dateToInput.value) {
            alert('Please select both From and To dates');
            return;
        }

        const fromDate = new Date(dateFromInput.value);
        const toDate = new Date(dateToInput.value);
        toDate.setHours(23, 59, 59, 999); // Include the entire end day

        if (fromDate > toDate) {
            alert('From date must be before To date');
            return;
        }

        // Check date range (max 30 days to avoid too much data)
        const daysDiff = (toDate - fromDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 30) {
            alert('Please select a date range of 30 days or less to avoid performance issues');
            return;
        }

        // Clear existing alerts before analyzing
        AlertManager.clearAlerts();

        // Disable button and show progress
        analyzeBtn.disabled = true;
        const originalText = analyzeBtn.textContent;
        analyzeBtn.textContent = 'Analyzing...';

        // Update status
        const indicator = document.getElementById('status-indicator');
        if (indicator) {
            indicator.className = 'status-indicator status-active';
            indicator.querySelector('.status-text').textContent = 'Analyzing historical data...';
        }

        try {
            const alertCount = await FuelMonitor.analyzeHistoricalData(fromDate, toDate, function(message, percent) {
                analyzeBtn.textContent = `${percent}% - ${message.split('(')[0].trim()}`;
            });

            // Update status
            if (indicator) {
                indicator.querySelector('.status-text').textContent = `Found ${alertCount} potential theft events`;
            }

            if (alertCount === 0) {
                alert('No suspicious fuel drops detected in the selected date range.');
            }

        } catch (error) {
            console.error('Analysis failed:', error);
            alert('Failed to analyze historical data: ' + error.message);

            if (indicator) {
                indicator.className = 'status-indicator status-error';
                indicator.querySelector('.status-text').textContent = 'Analysis failed';
            }
        } finally {
            // Re-enable button
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = originalText;
        }
    }

    /**
     * Trigger a test alert to verify the system works
     */
    function triggerTestAlert() {
        const testVehicles = [
            { name: 'Test Truck #101', id: 'test-101' },
            { name: 'Test Van #202', id: 'test-202' },
            { name: 'Test Car #303', id: 'test-303' }
        ];
        const severities = ['critical', 'high', 'medium'];

        // Pick random vehicle and severity
        const vehicle = testVehicles[Math.floor(Math.random() * testVehicles.length)];
        const severity = severities[Math.floor(Math.random() * severities.length)];

        // Generate realistic fuel drop values based on severity
        let fuelDrop, duration;
        if (severity === 'critical') {
            fuelDrop = 25 + Math.random() * 15; // 25-40%
            duration = Math.floor(3 + Math.random() * 7); // 3-10 min
        } else if (severity === 'high') {
            fuelDrop = 15 + Math.random() * 10; // 15-25%
            duration = Math.floor(10 + Math.random() * 10); // 10-20 min
        } else {
            fuelDrop = 10 + Math.random() * 5; // 10-15%
            duration = Math.floor(20 + Math.random() * 10); // 20-30 min
        }

        const previousLevel = 60 + Math.random() * 30; // 60-90%
        const currentLevel = previousLevel - fuelDrop;

        AlertManager.addAlert({
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            severity: severity,
            fuelDrop: fuelDrop,
            previousLevel: previousLevel,
            currentLevel: currentLevel,
            duration: Math.round(duration),
            location: 'Test Location'
        });

        console.log('Test alert triggered:', vehicle.name, severity);
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
