/**
 * Fuel monitoring module for Fuel Theft Monitor
 * Handles data polling, analysis, and theft detection
 */

const FuelMonitor = (function() {
    // Geotab API instance
    let api = null;

    // Monitoring state
    let isMonitoring = false;
    let pollInterval = null;
    let feedToken = null;

    // Vehicle data cache
    const vehicleCache = new Map();
    const fuelHistory = new Map(); // vehicleId -> [{timestamp, level}, ...]

    // Configuration
    let config = {
        dropThreshold: 10,      // Minimum % drop to trigger alert
        timeWindowMinutes: 30,  // Time window for detection
        pollIntervalSeconds: 30 // How often to poll for data
    };

    // Diagnostic IDs
    const DIAGNOSTIC_FUEL_LEVEL = 'DiagnosticFuelLevelId';
    const DIAGNOSTIC_IGNITION = 'DiagnosticIgnitionId';

    /**
     * Initialize the fuel monitor
     * @param {Object} geotabApi - Authenticated Geotab API instance
     */
    function init(geotabApi) {
        api = geotabApi;
        loadConfig();
    }

    /**
     * Start monitoring for fuel theft
     */
    async function startMonitoring() {
        if (isMonitoring) {
            console.log('Monitoring already active');
            return;
        }

        try {
            // Load vehicle list
            await loadVehicles();

            // Start polling
            isMonitoring = true;
            pollForFuelData();

            // Set up interval
            pollInterval = setInterval(pollForFuelData, config.pollIntervalSeconds * 1000);

            updateStatus('active', 'Monitoring active');
            console.log('Fuel monitoring started');

        } catch (error) {
            console.error('Failed to start monitoring:', error);
            updateStatus('error', 'Failed to start: ' + error.message);
        }
    }

    /**
     * Stop monitoring
     */
    function stopMonitoring() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        isMonitoring = false;
        updateStatus('inactive', 'Monitoring stopped');
        console.log('Fuel monitoring stopped');
    }

    /**
     * Load vehicle list from Geotab
     */
    async function loadVehicles() {
        try {
            const devices = await api.call('Get', {
                typeName: 'Device',
                search: {
                    fromDate: new Date().toISOString()
                }
            });

            devices.forEach(device => {
                vehicleCache.set(device.id, {
                    id: device.id,
                    name: device.name,
                    serialNumber: device.serialNumber
                });
            });

            console.log(`Loaded ${vehicleCache.size} vehicles`);

        } catch (error) {
            console.error('Failed to load vehicles:', error);
            throw error;
        }
    }

    /**
     * Poll for fuel data using GetFeed
     */
    async function pollForFuelData() {
        try {
            // Build the feed request
            const feedCall = {
                typeName: 'StatusData',
                search: {
                    diagnosticSearch: {
                        id: DIAGNOSTIC_FUEL_LEVEL
                    }
                },
                resultsLimit: 1000
            };

            // Include token if we have one (for incremental updates)
            if (feedToken) {
                feedCall.fromVersion = feedToken;
            }

            const result = await api.call('GetFeed', feedCall);

            // Store the new token for next request
            feedToken = result.toVersion;

            // Process fuel data
            if (result.data && result.data.length > 0) {
                await processFuelData(result.data);
            }

        } catch (error) {
            console.error('Error polling fuel data:', error);

            // Reset token on error to get fresh data
            if (error.message && error.message.includes('version')) {
                feedToken = null;
            }
        }
    }

    /**
     * Process incoming fuel data
     * @param {Array} fuelDataPoints - Array of StatusData entries
     */
    async function processFuelData(fuelDataPoints) {
        // Group by device
        const byDevice = new Map();

        fuelDataPoints.forEach(point => {
            const deviceId = point.device.id;
            if (!byDevice.has(deviceId)) {
                byDevice.set(deviceId, []);
            }
            byDevice.get(deviceId).push({
                timestamp: new Date(point.dateTime),
                level: point.data * 100, // Convert to percentage
                raw: point
            });
        });

        // Analyze each device's data
        for (const [deviceId, dataPoints] of byDevice) {
            await analyzeVehicleFuelData(deviceId, dataPoints);
        }
    }

    /**
     * Analyze fuel data for a specific vehicle
     * @param {string} deviceId - Vehicle device ID
     * @param {Array} newDataPoints - New fuel level readings
     */
    async function analyzeVehicleFuelData(deviceId, newDataPoints) {
        // Get or create history for this vehicle
        if (!fuelHistory.has(deviceId)) {
            fuelHistory.set(deviceId, []);
        }

        const history = fuelHistory.get(deviceId);

        // Sort new points by timestamp
        newDataPoints.sort((a, b) => a.timestamp - b.timestamp);

        // Analyze each new point against history
        for (const currentPoint of newDataPoints) {
            // Look for suspicious drops
            const detection = detectSuspiciousDrop(history, currentPoint);

            if (detection) {
                // Verify vehicle state (ignition off, stationary)
                const isStationary = await checkVehicleState(deviceId, currentPoint.timestamp);

                if (isStationary) {
                    // Get vehicle info
                    const vehicle = vehicleCache.get(deviceId) || { name: 'Unknown Vehicle', id: deviceId };

                    // Determine severity
                    const severity = determineSeverity(detection.dropPercent, detection.durationMinutes);

                    // Create alert
                    AlertManager.addAlert({
                        vehicleId: deviceId,
                        vehicleName: vehicle.name,
                        severity: severity,
                        fuelDrop: detection.dropPercent,
                        previousLevel: detection.previousLevel,
                        currentLevel: detection.currentLevel,
                        duration: Math.round(detection.durationMinutes)
                    });
                }
            }

            // Add to history (keep last 2 hours of data)
            history.push(currentPoint);
            pruneHistory(history);
        }
    }

    /**
     * Detect suspicious fuel drops
     * @param {Array} history - Historical fuel readings
     * @param {Object} currentPoint - Current fuel reading
     * @returns {Object|null} Detection result or null
     */
    function detectSuspiciousDrop(history, currentPoint) {
        if (history.length === 0) return null;

        // Look at recent readings within the time window
        const windowStart = new Date(currentPoint.timestamp.getTime() - (config.timeWindowMinutes * 60 * 1000));

        // Find readings in the time window
        const recentReadings = history.filter(h => h.timestamp >= windowStart && h.timestamp < currentPoint.timestamp);

        if (recentReadings.length === 0) return null;

        // Get the highest recent level (to detect drop from)
        const maxReading = recentReadings.reduce((max, r) => r.level > max.level ? r : max, recentReadings[0]);

        // Calculate drop
        const dropPercent = maxReading.level - currentPoint.level;
        const durationMinutes = (currentPoint.timestamp - maxReading.timestamp) / (1000 * 60);

        // Check if it meets threshold
        if (dropPercent >= config.dropThreshold && durationMinutes <= config.timeWindowMinutes) {
            return {
                dropPercent: dropPercent,
                previousLevel: maxReading.level,
                currentLevel: currentPoint.level,
                durationMinutes: durationMinutes,
                previousTimestamp: maxReading.timestamp
            };
        }

        return null;
    }

    /**
     * Check if vehicle was stationary during the time period
     * @param {string} deviceId - Vehicle device ID
     * @param {Date} timestamp - Time to check
     * @returns {boolean} True if vehicle was stationary
     */
    async function checkVehicleState(deviceId, timestamp) {
        try {
            // Get ignition status
            const fromDate = new Date(timestamp.getTime() - (5 * 60 * 1000)); // 5 min before

            const ignitionData = await api.call('Get', {
                typeName: 'StatusData',
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: DIAGNOSTIC_IGNITION },
                    fromDate: fromDate.toISOString(),
                    toDate: timestamp.toISOString()
                }
            });

            // Check if ignition was off (value = 0)
            if (ignitionData && ignitionData.length > 0) {
                const latestIgnition = ignitionData[ignitionData.length - 1];
                // Ignition off = 0, on = 1
                if (latestIgnition.data !== 0) {
                    return false; // Ignition was on, not suspicious
                }
            }

            // Also check for recent trips/movement
            const trips = await api.call('Get', {
                typeName: 'Trip',
                search: {
                    deviceSearch: { id: deviceId },
                    fromDate: fromDate.toISOString(),
                    toDate: timestamp.toISOString()
                }
            });

            // If there were active trips, vehicle wasn't stationary
            if (trips && trips.length > 0) {
                return false;
            }

            return true; // Vehicle was stationary

        } catch (error) {
            console.error('Error checking vehicle state:', error);
            // On error, still report (could be important)
            return true;
        }
    }

    /**
     * Determine alert severity based on drop characteristics
     * @param {number} dropPercent - Percentage of fuel drop
     * @param {number} durationMinutes - Time period of drop
     * @returns {string} Severity level
     */
    function determineSeverity(dropPercent, durationMinutes) {
        // CRITICAL: >25% drop in <10 minutes
        if (dropPercent > 25 && durationMinutes < 10) {
            return 'critical';
        }

        // HIGH: >15% drop in <20 minutes
        if (dropPercent > 15 && durationMinutes < 20) {
            return 'high';
        }

        // MEDIUM: >10% drop in <30 minutes (default threshold)
        return 'medium';
    }

    /**
     * Prune old history entries
     * @param {Array} history - Fuel history array
     */
    function pruneHistory(history) {
        const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000));

        while (history.length > 0 && history[0].timestamp < twoHoursAgo) {
            history.shift();
        }

        // Also limit to max 500 entries per vehicle
        while (history.length > 500) {
            history.shift();
        }
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration values
     */
    function updateConfig(newConfig) {
        config = { ...config, ...newConfig };
        saveConfig();

        // Restart polling with new interval if changed
        if (isMonitoring && newConfig.pollIntervalSeconds) {
            clearInterval(pollInterval);
            pollInterval = setInterval(pollForFuelData, config.pollIntervalSeconds * 1000);
        }
    }

    /**
     * Get current configuration
     */
    function getConfig() {
        return { ...config };
    }

    /**
     * Save configuration to localStorage
     */
    function saveConfig() {
        try {
            localStorage.setItem('fuelMonitorConfig', JSON.stringify(config));
        } catch (e) {
            console.error('Failed to save config:', e);
        }
    }

    /**
     * Load configuration from localStorage
     */
    function loadConfig() {
        try {
            const saved = localStorage.getItem('fuelMonitorConfig');
            if (saved) {
                config = { ...config, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    }

    /**
     * Update status indicator
     * @param {string} status - Status type (active, inactive, error)
     * @param {string} text - Status text
     */
    function updateStatus(status, text) {
        const indicator = document.getElementById('status-indicator');
        if (!indicator) return;

        indicator.className = `status-indicator status-${status}`;
        indicator.querySelector('.status-text').textContent = text;
    }

    /**
     * Check if monitoring is active
     */
    function isActive() {
        return isMonitoring;
    }

    /**
     * Get vehicle cache (for external access)
     */
    function getVehicles() {
        return [...vehicleCache.values()];
    }

    /**
     * Analyze historical fuel data for a date range
     * @param {Date} fromDate - Start date
     * @param {Date} toDate - End date
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    async function analyzeHistoricalData(fromDate, toDate, progressCallback) {
        try {
            // Ensure vehicles are loaded
            if (vehicleCache.size === 0) {
                await loadVehicles();
            }

            const vehicles = [...vehicleCache.values()];
            let processed = 0;
            let totalAlerts = 0;

            if (progressCallback) {
                progressCallback(`Analyzing ${vehicles.length} vehicles...`, 0);
            }

            // Process each vehicle
            for (const vehicle of vehicles) {
                try {
                    const alerts = await analyzeVehicleHistory(vehicle, fromDate, toDate);
                    totalAlerts += alerts;
                    processed++;

                    if (progressCallback) {
                        const percent = Math.round((processed / vehicles.length) * 100);
                        progressCallback(`Analyzed ${vehicle.name} (${processed}/${vehicles.length})`, percent);
                    }
                } catch (err) {
                    console.error(`Error analyzing vehicle ${vehicle.name}:`, err);
                }
            }

            if (progressCallback) {
                progressCallback(`Analysis complete. Found ${totalAlerts} potential theft events.`, 100);
            }

            return totalAlerts;

        } catch (error) {
            console.error('Historical analysis failed:', error);
            throw error;
        }
    }

    /**
     * Analyze historical fuel data for a single vehicle
     * @param {Object} vehicle - Vehicle object
     * @param {Date} fromDate - Start date
     * @param {Date} toDate - End date
     * @returns {number} Number of alerts found
     */
    async function analyzeVehicleHistory(vehicle, fromDate, toDate) {
        let alertCount = 0;

        try {
            // Fetch fuel level data for the date range
            const fuelData = await api.call('Get', {
                typeName: 'StatusData',
                search: {
                    deviceSearch: { id: vehicle.id },
                    diagnosticSearch: { id: DIAGNOSTIC_FUEL_LEVEL },
                    fromDate: fromDate.toISOString(),
                    toDate: toDate.toISOString()
                }
            });

            if (!fuelData || fuelData.length < 2) {
                return 0; // Not enough data
            }

            // Sort by timestamp
            fuelData.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

            // Build history array
            const history = [];

            for (const point of fuelData) {
                const currentPoint = {
                    timestamp: new Date(point.dateTime),
                    level: point.data * 100 // Convert to percentage
                };

                // Detect suspicious drops
                const detection = detectSuspiciousDrop(history, currentPoint);

                if (detection) {
                    // Check vehicle state at that time
                    const isStationary = await checkVehicleState(vehicle.id, currentPoint.timestamp);

                    if (isStationary) {
                        const severity = determineSeverity(detection.dropPercent, detection.durationMinutes);

                        // Add alert (mark as historical)
                        AlertManager.addAlert({
                            vehicleId: vehicle.id,
                            vehicleName: vehicle.name,
                            severity: severity,
                            fuelDrop: detection.dropPercent,
                            previousLevel: detection.previousLevel,
                            currentLevel: detection.currentLevel,
                            duration: Math.round(detection.durationMinutes),
                            timestamp: currentPoint.timestamp,
                            isHistorical: true
                        });

                        alertCount++;
                    }
                }

                // Add to history
                history.push(currentPoint);

                // Prune old entries (keep window + buffer)
                while (history.length > 0 &&
                       (currentPoint.timestamp - history[0].timestamp) > (config.timeWindowMinutes * 2 * 60 * 1000)) {
                    history.shift();
                }
            }

        } catch (error) {
            console.error(`Error fetching fuel data for ${vehicle.name}:`, error);
        }

        return alertCount;
    }

    // Public API
    return {
        init,
        startMonitoring,
        stopMonitoring,
        updateConfig,
        getConfig,
        isActive,
        getVehicles,
        analyzeHistoricalData
    };
})();
