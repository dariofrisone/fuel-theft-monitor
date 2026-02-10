/**
 * Alert management module for Fuel Theft Monitor
 * Handles alert display, storage, and export functionality
 */

const AlertManager = (function() {
    // Alert storage
    let alerts = [];
    let alertIdCounter = 0;

    // DOM elements cache
    let alertsList = null;
    let totalAlertsEl = null;
    let criticalCountEl = null;
    let highCountEl = null;
    let mediumCountEl = null;

    // Deduplication cache (vehicleId + timestamp window)
    const recentAlerts = new Map();
    const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Initialize the alert manager
     */
    function init() {
        alertsList = document.getElementById('alerts-list');
        totalAlertsEl = document.getElementById('total-alerts');
        criticalCountEl = document.getElementById('critical-count');
        highCountEl = document.getElementById('high-count');
        mediumCountEl = document.getElementById('medium-count');

        // Load saved alerts from localStorage
        loadAlerts();

        // Set up filter listeners
        document.getElementById('vehicle-filter').addEventListener('change', filterAlerts);
        document.getElementById('severity-filter').addEventListener('change', filterAlerts);

        // Set up export button
        document.getElementById('export-btn').addEventListener('click', exportToCSV);
    }

    /**
     * Add a new alert
     * @param {Object} alertData - Alert information
     * @returns {boolean} - Whether alert was added (false if deduplicated)
     */
    function addAlert(alertData) {
        // Check for duplicates
        if (isDuplicate(alertData)) {
            console.log('Alert deduplicated:', alertData.vehicleName);
            return false;
        }

        const alert = {
            id: ++alertIdCounter,
            vehicleId: alertData.vehicleId,
            vehicleName: alertData.vehicleName,
            severity: alertData.severity,
            fuelDrop: alertData.fuelDrop,
            previousLevel: alertData.previousLevel,
            currentLevel: alertData.currentLevel,
            duration: alertData.duration,
            timestamp: new Date().toISOString(),
            location: alertData.location || 'Unknown'
        };

        alerts.unshift(alert);

        // Update deduplication cache
        recentAlerts.set(alertData.vehicleId, Date.now());

        // Save to localStorage
        saveAlerts();

        // Update UI
        renderAlert(alert);
        updateStats();

        // Trigger notifications
        triggerNotifications(alert);

        // Update vehicle filter options
        updateVehicleFilter();

        return true;
    }

    /**
     * Check if an alert is a duplicate
     */
    function isDuplicate(alertData) {
        const lastAlertTime = recentAlerts.get(alertData.vehicleId);
        if (lastAlertTime && (Date.now() - lastAlertTime) < DEDUP_WINDOW_MS) {
            return true;
        }
        return false;
    }

    /**
     * Render a single alert card
     */
    function renderAlert(alert) {
        // Remove empty state if present
        const emptyState = alertsList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        const alertCard = document.createElement('div');
        alertCard.className = `alert-card ${alert.severity}`;
        alertCard.dataset.id = alert.id;
        alertCard.dataset.vehicleId = alert.vehicleId;
        alertCard.dataset.severity = alert.severity;

        const icon = getAlertIcon(alert.severity);
        const formattedTime = formatTimestamp(alert.timestamp);

        alertCard.innerHTML = `
            <div class="alert-icon">${icon}</div>
            <div class="alert-content">
                <div class="alert-header">
                    <span class="alert-vehicle">${escapeHtml(alert.vehicleName)}</span>
                    <span class="alert-severity ${alert.severity}">${alert.severity}</span>
                </div>
                <div class="alert-details">
                    <span class="alert-detail">
                        <strong>Fuel Drop:</strong> ${alert.fuelDrop.toFixed(1)}%
                    </span>
                    <span class="alert-detail">
                        <strong>From:</strong> ${alert.previousLevel.toFixed(1)}%
                        <strong>To:</strong> ${alert.currentLevel.toFixed(1)}%
                    </span>
                    <span class="alert-detail">
                        <strong>Duration:</strong> ${alert.duration} min
                    </span>
                </div>
            </div>
            <span class="alert-timestamp">${formattedTime}</span>
            <button class="alert-dismiss" onclick="AlertManager.dismissAlert(${alert.id})">&times;</button>
        `;

        alertsList.insertBefore(alertCard, alertsList.firstChild);
    }

    /**
     * Get icon based on severity
     */
    function getAlertIcon(severity) {
        switch (severity) {
            case 'critical': return '🚨';
            case 'high': return '⚠️';
            case 'medium': return '⚡';
            default: return '📢';
        }
    }

    /**
     * Format timestamp for display
     */
    function formatTimestamp(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString();
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Dismiss/remove an alert
     */
    function dismissAlert(alertId) {
        alerts = alerts.filter(a => a.id !== alertId);
        saveAlerts();

        const alertCard = alertsList.querySelector(`[data-id="${alertId}"]`);
        if (alertCard) {
            alertCard.remove();
        }

        updateStats();

        // Show empty state if no alerts
        if (alerts.length === 0) {
            alertsList.innerHTML = `
                <div class="empty-state">
                    <p>No alerts detected. Monitoring is active and will display suspicious fuel drops here.</p>
                </div>
            `;
        }
    }

    /**
     * Update statistics display
     */
    function updateStats() {
        const counts = {
            total: alerts.length,
            critical: alerts.filter(a => a.severity === 'critical').length,
            high: alerts.filter(a => a.severity === 'high').length,
            medium: alerts.filter(a => a.severity === 'medium').length
        };

        totalAlertsEl.textContent = counts.total;
        criticalCountEl.textContent = counts.critical;
        highCountEl.textContent = counts.high;
        mediumCountEl.textContent = counts.medium;
    }

    /**
     * Filter alerts based on selected criteria
     */
    function filterAlerts() {
        const vehicleFilter = document.getElementById('vehicle-filter').value;
        const severityFilter = document.getElementById('severity-filter').value;

        const alertCards = alertsList.querySelectorAll('.alert-card');
        alertCards.forEach(card => {
            const matchesVehicle = vehicleFilter === 'all' || card.dataset.vehicleId === vehicleFilter;
            const matchesSeverity = severityFilter === 'all' || card.dataset.severity === severityFilter;

            card.style.display = (matchesVehicle && matchesSeverity) ? 'flex' : 'none';
        });
    }

    /**
     * Update vehicle filter dropdown
     */
    function updateVehicleFilter() {
        const vehicleFilter = document.getElementById('vehicle-filter');
        const currentValue = vehicleFilter.value;

        // Get unique vehicles
        const vehicles = [...new Map(alerts.map(a => [a.vehicleId, a.vehicleName])).entries()];

        // Clear and rebuild options
        vehicleFilter.innerHTML = '<option value="all">All Vehicles</option>';
        vehicles.forEach(([id, name]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            vehicleFilter.appendChild(option);
        });

        // Restore selection if still valid
        if ([...vehicleFilter.options].some(opt => opt.value === currentValue)) {
            vehicleFilter.value = currentValue;
        }
    }

    /**
     * Trigger notifications for new alert
     */
    function triggerNotifications(alert) {
        const settings = getSettings();

        // Sound notification
        if (settings.soundEnabled) {
            playAlertSound(alert.severity);
        }

        // Browser notification
        if (settings.browserNotifications && Notification.permission === 'granted') {
            new Notification('Fuel Theft Alert', {
                body: `${alert.vehicleName}: ${alert.fuelDrop.toFixed(1)}% fuel drop detected`,
                icon: 'images/fuel-icon.svg',
                tag: `fuel-alert-${alert.id}`
            });
        }
    }

    /**
     * Play alert sound
     */
    function playAlertSound(severity) {
        // Create oscillator for alert tone
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // Different frequencies for different severities
            const frequencies = {
                critical: 880,
                high: 660,
                medium: 440
            };

            oscillator.frequency.value = frequencies[severity] || 440;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (e) {
            console.log('Audio notification not available');
        }
    }

    /**
     * Get settings from localStorage
     */
    function getSettings() {
        try {
            return JSON.parse(localStorage.getItem('fuelMonitorSettings')) || {
                soundEnabled: true,
                browserNotifications: true
            };
        } catch (e) {
            return { soundEnabled: true, browserNotifications: true };
        }
    }

    /**
     * Save alerts to localStorage
     */
    function saveAlerts() {
        try {
            // Keep only last 100 alerts
            const alertsToSave = alerts.slice(0, 100);
            localStorage.setItem('fuelMonitorAlerts', JSON.stringify(alertsToSave));
        } catch (e) {
            console.error('Failed to save alerts:', e);
        }
    }

    /**
     * Load alerts from localStorage
     */
    function loadAlerts() {
        try {
            const saved = localStorage.getItem('fuelMonitorAlerts');
            if (saved) {
                alerts = JSON.parse(saved);
                alertIdCounter = alerts.length > 0 ? Math.max(...alerts.map(a => a.id)) : 0;

                // Render saved alerts
                alertsList.innerHTML = '';
                if (alerts.length === 0) {
                    alertsList.innerHTML = `
                        <div class="empty-state">
                            <p>No alerts detected. Monitoring is active and will display suspicious fuel drops here.</p>
                        </div>
                    `;
                } else {
                    alerts.slice().reverse().forEach(alert => renderAlert(alert));
                }

                updateStats();
                updateVehicleFilter();
            }
        } catch (e) {
            console.error('Failed to load alerts:', e);
        }
    }

    /**
     * Export alerts to CSV
     */
    function exportToCSV() {
        if (alerts.length === 0) {
            alert('No alerts to export');
            return;
        }

        const headers = ['ID', 'Vehicle', 'Severity', 'Fuel Drop (%)', 'Previous Level (%)',
                        'Current Level (%)', 'Duration (min)', 'Timestamp', 'Location'];

        const rows = alerts.map(a => [
            a.id,
            `"${a.vehicleName}"`,
            a.severity,
            a.fuelDrop.toFixed(1),
            a.previousLevel.toFixed(1),
            a.currentLevel.toFixed(1),
            a.duration,
            a.timestamp,
            `"${a.location}"`
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `fuel-theft-alerts-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Clear all alerts
     */
    function clearAlerts() {
        alerts = [];
        saveAlerts();
        loadAlerts();
    }

    /**
     * Get all alerts (for external access)
     */
    function getAlerts() {
        return [...alerts];
    }

    // Public API
    return {
        init,
        addAlert,
        dismissAlert,
        clearAlerts,
        getAlerts,
        updateStats
    };
})();
