// ==UserScript==
// @name         LDStatus Pro
// @namespace    http://tampermonkey.net/
// @version      2.8.7
// @description  在 Linux.do 和 IDCFlare 页面显示信任级别进度，支持历史趋势、里程碑通知、阅读时间统计
// @author       JackLiii
// @license      MIT
// @match        https://linux.do/*
// @match        https://idcflare.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_notification
// @connect      connect.linux.do
// @connect      linux.do
// @connect      connect.idcflare.com
// @connect      idcflare.com
// @connect      github.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/caigg188/LDStatusPro/main/LDStatusPro.user.js
// @downloadURL  https://raw.githubusercontent.com/caigg188/LDStatusPro/main/LDStatusPro.user.js
// @icon         https://linux.do/uploads/default/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 网站配置 ====================
    const SITE_CONFIG = {
        'linux.do': {
            name: 'Linux.do',
            icon: 'https://linux.do/uploads/default/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png',
            apiUrl: 'https://connect.linux.do',
            colorPrimary: '#6366f1',
            colorSecondary: '#0ea5e9'
        },
        'idcflare.com': {
            name: 'IDCFlare',
            icon: 'https://idcflare.com/uploads/default/optimized/1X/8746f94a48ddc8140e8c7a52084742f38d3f5085_2_180x180.png',
            apiUrl: 'https://connect.idcflare.com',
            colorPrimary: '#f97316',
            colorSecondary: '#d97706'
        }
    };

    function detectCurrentSite() {
        const hostname = window.location.hostname;
        for (const [domain, config] of Object.entries(SITE_CONFIG)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return { domain, ...config };
            }
        }
        return null;
    }

    const CURRENT_SITE = detectCurrentSite();
    if (!CURRENT_SITE) {
        console.warn('[LDStatus Pro] 不支持的网站，脚本将不运行');
        return;
    }

    // ==================== 配置常量 ====================
    const CONFIG = {
        STORAGE_KEYS: {
            position: 'ldsp_position',
            collapsed: 'ldsp_collapsed',
            theme: 'ldsp_theme',
            history: 'ldsp_history',
            milestones: 'ldsp_milestones',
            lastNotify: 'ldsp_last_notify',
            lastVisit: 'ldsp_last_visit',
            trendTab: 'ldsp_trend_tab',
            todayData: 'ldsp_today_data',
            userAvatar: 'ldsp_user_avatar',
            readingTime: 'ldsp_reading_time',
            todayReadingStart: 'ldsp_today_reading_start',
            currentUser: 'ldsp_current_user',
            userDataMap: 'ldsp_user_data_map',
            density: 'ldsp_density'
        },
        SITE_PREFIX: CURRENT_SITE.domain.replace('.', '_'),
        USER_SPECIFIC_KEYS: [
            'history', 'milestones', 'lastVisit', 'todayData',
            'userAvatar', 'readingTime', 'todayReadingStart'
        ],
        REFRESH_INTERVAL: 300000,
        MAX_HISTORY_DAYS: 365,
        READING_TRACK_INTERVAL: 10000,
        READING_IDLE_THRESHOLD: 60000,
        READING_SAVE_INTERVAL: 30000,
        STORAGE_DEBOUNCE: 1000,
        NETWORK_RETRY_COUNT: 3,
        NETWORK_RETRY_DELAY: 1000,
        MILESTONES: {
            '浏览话题': [100, 500, 1000, 2000, 5000],
            '已读帖子': [500, 1000, 5000, 10000, 20000],
            '获赞': [10, 50, 100, 500, 1000],
            '送出赞': [50, 100, 500, 1000, 2000],
            '回复': [10, 50, 100, 500, 1000]
        },
        // 增量统计显示的字段配置
        TREND_FIELDS: [
            { key: '浏览话题', searchKey: '浏览的话题', label: '浏览话题' },
            { key: '已读帖子', searchKey: '已读帖子', label: '已读帖子' },
            { key: '点赞', searchKey: '送出赞', label: '点赞' },
            { key: '回复', searchKey: '回复', label: '回复' },
            { key: '获赞', searchKey: '获赞', label: '获赞' }
        ],
        READING_LEVELS: [
            { min: 0, label: '刚起步', icon: '🌱', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' },
            { min: 30, label: '热身中', icon: '📖', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
            { min: 90, label: '渐入佳境', icon: '📚', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
            { min: 180, label: '沉浸阅读', icon: '🔥', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
            { min: 300, label: '深度学习', icon: '⚡', color: '#f97316', bg: 'rgba(249, 115, 22, 0.15)' },
            { min: 450, label: 'LD达人', icon: '🏆', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
            { min: 600, label: '超级水怪', icon: '👑', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' }
        ],
        HEATMAP_LEVELS: {
            level0: 1,
            level1: 30,
            level2: 90,
            level3: 180,
            level4: 180
        }
    };

    // ==================== 屏幕尺寸检测 ====================
    function getScreenSize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (width < 1400 || height < 800) return 'small';
        if (width < 1920) return 'medium';
        return 'large';
    }

    function getPanelConfig() {
        const size = getScreenSize();
        const configs = {
            small: { width: 280, maxHeight: Math.min(window.innerHeight - 100, 450), fontSize: 11, padding: 10, avatarSize: 38, ringSize: 70 },
            medium: { width: 300, maxHeight: Math.min(window.innerHeight - 100, 520), fontSize: 12, padding: 12, avatarSize: 42, ringSize: 76 },
            large: { width: 320, maxHeight: 580, fontSize: 12, padding: 14, avatarSize: 46, ringSize: 80 }
        };
        return configs[size] || configs.large;
    }

    // ==================== LRU 缓存 ====================
    class LRUCache {
        constructor(maxSize = 50) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }

        get(key) {
            if (!this.cache.has(key)) return undefined;
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        set(key, value) {
            if (this.cache.has(key)) {
                this.cache.delete(key);
            } else if (this.cache.size >= this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            this.cache.set(key, value);
        }

        has(key) {
            return this.cache.has(key);
        }

        clear() {
            this.cache.clear();
        }
    }

    // ==================== 状态管理器 ====================
    class StateManager {
        constructor() {
            this.state = {
                user: { name: null, level: null, avatar: null },
                requirements: [],
                history: [],
                ui: {
                    collapsed: false,
                    theme: 'dark',
                    trendTab: 'today',
                    density: 'normal',
                    activeTab: 'reqs',
                    loading: false
                },
                reading: {
                    todayMinutes: 0,
                    totalMinutes: 0,
                    isTracking: true
                },
                status: {
                    isOK: false,
                    loading: true,
                    error: null
                }
            };
            this.listeners = new Map();
            this.cache = new LRUCache(100);
        }

        get(path) {
            return this.getNestedValue(this.state, path);
        }

        set(path, value) {
            this.setNestedValue(this.state, path, value);
            this.notify(path);
        }

        getNestedValue(obj, path) {
            return path.split('.').reduce((acc, part) => acc?.[part], obj);
        }

        setNestedValue(obj, path, value) {
            const parts = path.split('.');
            const last = parts.pop();
            const target = parts.reduce((acc, part) => {
                if (!acc[part]) acc[part] = {};
                return acc[part];
            }, obj);
            target[last] = value;
        }

        subscribe(path, callback) {
            if (!this.listeners.has(path)) {
                this.listeners.set(path, new Set());
            }
            this.listeners.get(path).add(callback);
            return () => this.listeners.get(path)?.delete(callback);
        }

        notify(path) {
            const parts = path.split('.');
            let currentPath = '';
            parts.forEach((part, index) => {
                currentPath = index === 0 ? part : `${currentPath}.${part}`;
                this.listeners.get(currentPath)?.forEach(cb => {
                    try {
                        cb(this.get(currentPath));
                    } catch (e) {
                        console.error('[StateManager] Listener error:', e);
                    }
                });
            });
            this.listeners.get('*')?.forEach(cb => cb(this.state));
        }

        getCached(key, compute) {
            if (this.cache.has(key)) {
                return this.cache.get(key);
            }
            const value = compute();
            this.cache.set(key, value);
            return value;
        }

        invalidateCache(pattern) {
            if (!pattern) {
                this.cache.clear();
            }
        }
    }

    // ==================== 存储管理器 ====================
    class StorageManager {
        constructor() {
            this.pendingWrites = new Map();
            this.writeTimer = null;
            this._currentUser = null;
        }

        getCurrentUser() {
            if (this._currentUser) return this._currentUser;
            const userLink = document.querySelector('.current-user a[href^="/u/"]');
            if (userLink) {
                const match = userLink.getAttribute('href').match(/\/u\/([^/]+)/);
                if (match) {
                    this._currentUser = match[1];
                    this.setGlobal('currentUser', this._currentUser);
                    return this._currentUser;
                }
            }
            this._currentUser = this.getGlobal('currentUser', null);
            return this._currentUser;
        }

        setCurrentUser(username) {
            this._currentUser = username;
            this.setGlobal('currentUser', username);
        }

        getUserKey(key) {
            const user = this.getCurrentUser();
            const baseKey = CONFIG.STORAGE_KEYS[key];
            const sitePrefix = `${CONFIG.SITE_PREFIX}_`;
            if (user && CONFIG.USER_SPECIFIC_KEYS.includes(key)) {
                return `${sitePrefix}${baseKey}_${user}`;
            }
            return `${sitePrefix}${baseKey}`;
        }

        get(key, defaultValue = null) {
            const storageKey = this.getUserKey(key);
            return GM_getValue(storageKey, defaultValue);
        }

        set(key, value) {
            const storageKey = this.getUserKey(key);
            this.pendingWrites.set(storageKey, value);
            this.scheduleWrite();
        }

        setImmediate(key, value) {
            const storageKey = this.getUserKey(key);
            GM_setValue(storageKey, value);
        }

        getGlobal(key, defaultValue = null) {
            const sitePrefix = `${CONFIG.SITE_PREFIX}_`;
            const storageKey = `${sitePrefix}${CONFIG.STORAGE_KEYS[key]}`;
            return GM_getValue(storageKey, defaultValue);
        }

        setGlobal(key, value) {
            const sitePrefix = `${CONFIG.SITE_PREFIX}_`;
            const storageKey = `${sitePrefix}${CONFIG.STORAGE_KEYS[key]}`;
            this.pendingWrites.set(storageKey, value);
            this.scheduleWrite();
        }

        setGlobalImmediate(key, value) {
            const sitePrefix = `${CONFIG.SITE_PREFIX}_`;
            const storageKey = `${sitePrefix}${CONFIG.STORAGE_KEYS[key]}`;
            GM_setValue(storageKey, value);
        }

        scheduleWrite() {
            if (this.writeTimer) return;
            this.writeTimer = setTimeout(() => {
                this.flush();
                this.writeTimer = null;
            }, CONFIG.STORAGE_DEBOUNCE);
        }

        flush() {
            this.pendingWrites.forEach((value, key) => {
                try {
                    GM_setValue(key, value);
                } catch (e) {
                    console.error('[StorageManager] Write error:', key, e);
                }
            });
            this.pendingWrites.clear();
        }

        migrateOldData(username) {
            const migrationFlag = `ldsp_migrated_v3_${username}`;
            if (GM_getValue(migrationFlag, false)) return;

            CONFIG.USER_SPECIFIC_KEYS.forEach(key => {
                const oldKey = CONFIG.STORAGE_KEYS[key];
                const newKey = `${CONFIG.SITE_PREFIX}_${oldKey}_${username}`;
                const oldData = GM_getValue(oldKey, null);
                if (oldData !== null && GM_getValue(newKey, null) === null) {
                    GM_setValue(newKey, oldData);
                }
            });

            this.migrateReadingTimeData(username);
            GM_setValue(migrationFlag, true);
        }

        migrateReadingTimeData(username) {
            const readingKey = `${CONFIG.SITE_PREFIX}_${CONFIG.STORAGE_KEYS.readingTime}_${username}`;
            const oldData = GM_getValue(readingKey, null);

            if (oldData && typeof oldData === 'object') {
                if (oldData.date && oldData.minutes !== undefined && !oldData.dailyData) {
                    const newData = {
                        version: 3,
                        dailyData: {
                            [oldData.date]: {
                                totalMinutes: oldData.minutes || 0,
                                lastActive: oldData.lastActive || Date.now(),
                                sessions: []
                            }
                        },
                        monthlyCache: {},
                        yearlyCache: {}
                    };
                    GM_setValue(readingKey, newData);
                } else if (oldData.version === 2) {
                    oldData.version = 3;
                    oldData.monthlyCache = oldData.monthlyCache || {};
                    oldData.yearlyCache = oldData.yearlyCache || {};

                    if (oldData.dailyData) {
                        Object.keys(oldData.dailyData).forEach(dateKey => {
                            try {
                                const date = new Date(dateKey);
                                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                                const yearKey = `${date.getFullYear()}`;
                                const minutes = oldData.dailyData[dateKey].totalMinutes || 0;

                                oldData.monthlyCache[monthKey] = (oldData.monthlyCache[monthKey] || 0) + minutes;
                                oldData.yearlyCache[yearKey] = (oldData.yearlyCache[yearKey] || 0) + minutes;
                            } catch (e) {}
                        });
                    }
                    GM_setValue(readingKey, oldData);
                }
            }
        }
    }

    // ==================== 网络管理器 ====================
    class NetworkManager {
        constructor() {
            this.requestQueue = [];
            this.isProcessing = false;
        }

        async fetch(url, options = {}) {
            const { maxRetries = CONFIG.NETWORK_RETRY_COUNT, timeout = 15000 } = options;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    return await this.doFetch(url, timeout);
                } catch (error) {
                    if (attempt === maxRetries - 1) {
                        throw error;
                    }
                    await this.sleep(CONFIG.NETWORK_RETRY_DELAY * Math.pow(2, attempt));
                }
            }
        }

        doFetch(url, timeout) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout,
                    onload: res => {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.responseText);
                        } else {
                            reject(new Error(`HTTP ${res.status}: ${res.statusText}`));
                        }
                    },
                    onerror: () => reject(new Error('Network error')),
                    ontimeout: () => reject(new Error('Request timeout'))
                });
            });
        }

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    // ==================== 历史数据管理器 ====================
    class HistoryManager {
        constructor(storage) {
            this.storage = storage;
            this.cache = new LRUCache(50);
            this.dateIndex = new Map();
        }

        getHistory() {
            const history = this.storage.get('history', []);
            const cutoff = Date.now() - CONFIG.MAX_HISTORY_DAYS * 86400000;
            return history.filter(h => h.ts > cutoff);
        }

        addHistory(data, readingTime = 0) {
            const history = this.getHistory();
            const now = Date.now();
            const today = new Date().toDateString();
            const idx = history.findIndex(h => new Date(h.ts).toDateString() === today);
            const record = { ts: now, data, readingTime };

            if (idx >= 0) {
                history[idx] = record;
            } else {
                history.push(record);
            }

            this.storage.set('history', history);
            this.invalidateCache();
            return history;
        }

        buildIndex(history) {
            this.dateIndex.clear();
            history.forEach((h, idx) => {
                const dateKey = new Date(h.ts).toDateString();
                if (!this.dateIndex.has(dateKey)) {
                    this.dateIndex.set(dateKey, []);
                }
                this.dateIndex.get(dateKey).push(idx);
            });
        }

        getDataForDateRange(history, startDate, endDate) {
            const cacheKey = `range_${startDate}_${endDate}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const result = history.filter(h => {
                const ts = h.ts;
                return ts >= startDate && ts <= endDate;
            });

            this.cache.set(cacheKey, result);
            return result;
        }

        // 计算每日增量
        aggregateDailyIncrements(history, reqs, maxDays) {
            const cacheKey = `daily_${maxDays}_${history.length}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const dayMap = new Map();
            const historyByDay = new Map();

            history.forEach(h => {
                const day = new Date(h.ts).toDateString();
                if (!historyByDay.has(day)) {
                    historyByDay.set(day, []);
                }
                historyByDay.get(day).push(h);
            });

            const sortedDays = Array.from(historyByDay.keys()).sort((a, b) =>
                new Date(a).getTime() - new Date(b).getTime()
            );

            let prevData = null;
            sortedDays.forEach(day => {
                const dayRecords = historyByDay.get(day);
                const latestRecord = dayRecords[dayRecords.length - 1];

                if (!dayMap.has(day)) {
                    dayMap.set(day, {});
                }

                const dayData = dayMap.get(day);
                reqs.forEach(req => {
                    const currentVal = latestRecord.data[req.name] || 0;
                    const prevVal = prevData ? (prevData[req.name] || 0) : 0;
                    dayData[req.name] = currentVal - prevVal;
                });

                prevData = { ...latestRecord.data };
            });

            this.cache.set(cacheKey, dayMap);
            return dayMap;
        }

        // 计算每周增量（用于本月视图）
        aggregateWeeklyIncrements(history, reqs) {
            const cacheKey = `weekly_${history.length}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();

            // 获取本月的周列表
            const weeks = this.getWeeksInMonth(currentYear, currentMonth);
            const weekMap = new Map();

            // 按周分组历史记录
            const historyByWeek = new Map();
            weeks.forEach((week, idx) => {
                historyByWeek.set(idx, []);
            });

            history.forEach(h => {
                const date = new Date(h.ts);
                if (date.getFullYear() === currentYear && date.getMonth() === currentMonth) {
                    weeks.forEach((week, idx) => {
                        if (date >= week.start && date <= week.end) {
                            historyByWeek.get(idx).push(h);
                        }
                    });
                }
            });

            // 获取上月最后一条记录作为基准
            let prevData = null;
            const lastMonthRecords = history.filter(h => {
                const date = new Date(h.ts);
                return date < new Date(currentYear, currentMonth, 1);
            });
            if (lastMonthRecords.length > 0) {
                prevData = { ...lastMonthRecords[lastMonthRecords.length - 1].data };
            }

            // 计算每周增量
            weeks.forEach((week, idx) => {
                const weekRecords = historyByWeek.get(idx);
                const weekData = {};

                if (weekRecords.length > 0) {
                    const latestRecord = weekRecords[weekRecords.length - 1];
                    reqs.forEach(req => {
                        const currentVal = latestRecord.data[req.name] || 0;
                        const prevVal = prevData ? (prevData[req.name] || 0) : 0;
                        weekData[req.name] = currentVal - prevVal;
                    });
                    prevData = { ...latestRecord.data };
                } else {
                    reqs.forEach(req => {
                        weekData[req.name] = 0;
                    });
                }

                weekMap.set(idx, {
                    weekNum: idx + 1,
                    start: week.start,
                    end: week.end,
                    label: `第${idx + 1}周`,
                    data: weekData
                });
            });

            this.cache.set(cacheKey, weekMap);
            return weekMap;
        }

        // 获取某月的周列表
        getWeeksInMonth(year, month) {
            const weeks = [];
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);

            let weekStart = new Date(firstDay);
            let weekNum = 1;

            while (weekStart <= lastDay) {
                let weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);

                if (weekEnd > lastDay) {
                    weekEnd = new Date(lastDay);
                }

                weeks.push({
                    start: new Date(weekStart),
                    end: weekEnd,
                    weekNum: weekNum++
                });

                weekStart = new Date(weekEnd);
                weekStart.setDate(weekStart.getDate() + 1);
            }

            return weeks;
        }

        // 计算每月增量
        aggregateMonthlyIncrements(history, reqs) {
            const cacheKey = `monthly_${history.length}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const monthMap = new Map();
            const historyByMonth = new Map();

            history.forEach(h => {
                const date = new Date(h.ts);
                const monthKey = new Date(date.getFullYear(), date.getMonth(), 1).toDateString();
                if (!historyByMonth.has(monthKey)) {
                    historyByMonth.set(monthKey, []);
                }
                historyByMonth.get(monthKey).push(h);
            });

            const sortedMonths = Array.from(historyByMonth.keys()).sort((a, b) =>
                new Date(a).getTime() - new Date(b).getTime()
            );

            let prevData = null;
            sortedMonths.forEach(month => {
                const monthRecords = historyByMonth.get(month);
                const latestRecord = monthRecords[monthRecords.length - 1];

                if (!monthMap.has(month)) {
                    monthMap.set(month, {});
                }

                const monthData = monthMap.get(month);
                reqs.forEach(req => {
                    const currentVal = latestRecord.data[req.name] || 0;
                    const prevVal = prevData ? (prevData[req.name] || 0) : 0;
                    monthData[req.name] = currentVal - prevVal;
                });

                prevData = { ...latestRecord.data };
            });

            this.cache.set(cacheKey, monthMap);
            return monthMap;
        }

        invalidateCache() {
            this.cache.clear();
        }
    }

    // ==================== 阅读时间追踪器 ====================
    class ReadingTimeTracker {
        constructor(storage) {
            this.storage = storage;
            this.isActive = true;
            this.lastActivityTime = Date.now();
            this.sessionStartTime = Date.now();
            this.lastSaveTime = Date.now();
            this.trackingInterval = null;
            this.saveInterval = null;
            this.initialized = false;
            this.boundListeners = new Map();
            this.yearDataCache = null;
            this.yearDataCacheTime = 0;
        }

        init(username) {
            if (this.initialized) return;
            this.storage.migrateOldData(username);
            this.bindActivityListeners();
            this.startTracking();
            this.startAutoSave();
            this.handleVisibilityChange();
            this.initialized = true;
        }

        bindActivityListeners() {
            const handler = this.throttle(() => this.recordActivity(), 1000);
            const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];

            events.forEach(event => {
                this.boundListeners.set(event, handler);
                document.addEventListener(event, handler, { passive: true });
            });
        }

        throttle(func, limit) {
            let inThrottle;
            return function(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        }

        recordActivity() {
            const now = Date.now();
            if (!this.isActive) {
                this.isActive = true;
                this.sessionStartTime = now;
            }
            this.lastActivityTime = now;
        }

        startTracking() {
            this.trackingInterval = setInterval(() => {
                this.checkAndAccumulate();
            }, CONFIG.READING_TRACK_INTERVAL);
        }

        startAutoSave() {
            this.saveInterval = setInterval(() => {
                this.saveReadingTime();
            }, CONFIG.READING_SAVE_INTERVAL);
        }

        checkAndAccumulate() {
            const now = Date.now();
            const timeSinceLastActivity = now - this.lastActivityTime;

            if (this.isActive && timeSinceLastActivity > CONFIG.READING_IDLE_THRESHOLD) {
                this.isActive = false;
            } else if (!this.isActive && timeSinceLastActivity < CONFIG.READING_IDLE_THRESHOLD) {
                this.isActive = true;
                this.sessionStartTime = now;
            }
        }

        handleVisibilityChange() {
            const visibilityHandler = () => {
                if (document.hidden) {
                    this.saveReadingTime();
                    this.isActive = false;
                } else {
                    this.lastActivityTime = Date.now();
                    this.isActive = true;
                }
            };

            const beforeUnloadHandler = () => {
                this.saveReadingTime();
            };

            document.addEventListener('visibilitychange', visibilityHandler);
            window.addEventListener('beforeunload', beforeUnloadHandler);

            this.boundListeners.set('visibilitychange', visibilityHandler);
            this.boundListeners.set('beforeunload', beforeUnloadHandler);
        }

        saveReadingTime() {
            const user = this.storage.getCurrentUser();
            if (!user) return;

            const todayKey = this.getTodayKey();
            const now = Date.now();
            let stored = this.storage.get('readingTime', null);

            if (!stored || typeof stored !== 'object' || !stored.dailyData) {
                stored = { version: 3, dailyData: {}, monthlyCache: {}, yearlyCache: {} };
            }

            let todayData = stored.dailyData[todayKey];
            if (!todayData) {
                todayData = { totalMinutes: 0, lastActive: now, sessions: [], lastSaveTime: now };
            }

            const timeSinceLastSave = (now - this.lastSaveTime) / 1000;
            let timeToAddSeconds = 0;

            if (timeSinceLastSave > 0) {
                const timeSinceLastActivity = now - this.lastActivityTime;
                if (timeSinceLastActivity <= CONFIG.READING_IDLE_THRESHOLD) {
                    timeToAddSeconds = timeSinceLastSave;
                } else {
                    const activeTime = Math.max(0, timeSinceLastSave - (timeSinceLastActivity - CONFIG.READING_IDLE_THRESHOLD) / 1000);
                    timeToAddSeconds = activeTime;
                }
            }

            const timeToAddMinutes = timeToAddSeconds / 60;

            if (timeToAddMinutes > 0.1) {
                todayData.totalMinutes += timeToAddMinutes;
                todayData.lastActive = now;
                todayData.lastSaveTime = now;

                if (!todayData.sessions) todayData.sessions = [];
                todayData.sessions.push({
                    saveTime: now,
                    addedMinutes: timeToAddMinutes,
                    totalMinutes: todayData.totalMinutes
                });

                stored.dailyData[todayKey] = todayData;
                this.updateReadingCache(stored, todayKey, timeToAddMinutes);
                this.cleanOldData(stored);
                this.storage.set('readingTime', stored);
                this.lastSaveTime = now;
                this.yearDataCache = null;
            }
        }

        updateReadingCache(stored, dateKey, minutesAdded) {
            if (!stored.monthlyCache) stored.monthlyCache = {};
            if (!stored.yearlyCache) stored.yearlyCache = {};

            try {
                const date = new Date(dateKey);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const yearKey = `${date.getFullYear()}`;

                stored.monthlyCache[monthKey] = (stored.monthlyCache[monthKey] || 0) + minutesAdded;
                stored.yearlyCache[yearKey] = (stored.yearlyCache[yearKey] || 0) + minutesAdded;
            } catch (e) {}
        }

        cleanOldData(stored) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - CONFIG.MAX_HISTORY_DAYS);

            Object.keys(stored.dailyData).forEach(dateKey => {
                if (new Date(dateKey) < cutoffDate) {
                    delete stored.dailyData[dateKey];
                }
            });

            if (stored.monthlyCache) {
                Object.keys(stored.monthlyCache).forEach(monthKey => {
                    try {
                        const [year, month] = monthKey.split('-');
                        if (new Date(parseInt(year), parseInt(month) - 1, 1) < cutoffDate) {
                            delete stored.monthlyCache[monthKey];
                        }
                    } catch (e) {}
                });
            }
        }

        getTodayKey() {
            return new Date().toDateString();
        }

        getTodayReadingTime() {
            const user = this.storage.getCurrentUser();
            if (!user) return 0;

            const todayKey = this.getTodayKey();
            const stored = this.storage.get('readingTime', null);
            const now = Date.now();

            let savedMinutes = 0;
            if (stored?.dailyData?.[todayKey]) {
                savedMinutes = stored.dailyData[todayKey].totalMinutes || 0;
            }

            let unsavedMinutes = 0;
            if (this.lastSaveTime) {
                const timeSinceLastSave = (now - this.lastSaveTime) / 1000;
                const timeSinceLastActivity = now - this.lastActivityTime;

                if (timeSinceLastActivity <= CONFIG.READING_IDLE_THRESHOLD) {
                    unsavedMinutes = timeSinceLastSave / 60;
                } else {
                    const activeSeconds = Math.max(0, timeSinceLastSave - (timeSinceLastActivity - CONFIG.READING_IDLE_THRESHOLD) / 1000);
                    unsavedMinutes = activeSeconds / 60;
                }
            }

            return savedMinutes + Math.max(0, unsavedMinutes);
        }

        getReadingTimeForDate(dateKey) {
            const stored = this.storage.get('readingTime', null);
            return stored?.dailyData?.[dateKey]?.totalMinutes || 0;
        }

        getReadingTimeHistory(days = 7) {
            const result = [];
            const now = new Date();

            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(date.getDate() - i);
                const dateKey = date.toDateString();

                result.push({
                    date: dateKey,
                    label: this.formatDateShort(date.getTime()),
                    dayName: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
                    minutes: i === 0 ? this.getTodayReadingTime() : this.getReadingTimeForDate(dateKey),
                    isToday: i === 0
                });
            }

            return result;
        }

        getYearData() {
            const now = Date.now();
            if (this.yearDataCache && (now - this.yearDataCacheTime) < 5000) {
                return this.yearDataCache;
            }

            const today = new Date();
            const currentYear = today.getFullYear();
            const stored = this.storage.get('readingTime', null);
            const dailyData = stored?.dailyData || {};

            const dateMap = new Map();
            Object.keys(dailyData).forEach(dateKey => {
                const date = new Date(dateKey);
                if (date.getFullYear() === currentYear) {
                    dateMap.set(dateKey, dailyData[dateKey].totalMinutes || 0);
                }
            });

            const todayKey = this.getTodayKey();
            dateMap.set(todayKey, this.getTodayReadingTime());

            this.yearDataCache = dateMap;
            this.yearDataCacheTime = now;

            return dateMap;
        }

        getTotalReadingTime() {
            const stored = this.storage.get('readingTime', null);
            if (!stored?.dailyData) return this.getTodayReadingTime();

            let total = 0;
            const todayKey = this.getTodayKey();

            Object.keys(stored.dailyData).forEach(dateKey => {
                if (dateKey === todayKey) {
                    total += this.getTodayReadingTime();
                } else {
                    total += stored.dailyData[dateKey].totalMinutes || 0;
                }
            });

            return total;
        }

        formatDateShort(ts) {
            const d = new Date(ts);
            return `${d.getMonth() + 1}/${d.getDate()}`;
        }

        destroy() {
            this.boundListeners.forEach((handler, event) => {
                if (event === 'visibilitychange') {
                    document.removeEventListener(event, handler);
                } else if (event === 'beforeunload') {
                    window.removeEventListener(event, handler);
                } else {
                    document.removeEventListener(event, handler);
                }
            });
            this.boundListeners.clear();

            if (this.trackingInterval) clearInterval(this.trackingInterval);
            if (this.saveInterval) clearInterval(this.saveInterval);

            this.saveReadingTime();
        }
    }

    // ==================== 工具函数 ====================
    const Utils = {
        compareVersion(v1, v2) {
            const p1 = v1.split('.').map(Number);
            const p2 = v2.split('.').map(Number);
            for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
                const a = p1[i] || 0, b = p2[i] || 0;
                if (a !== b) return a > b ? 1 : -1;
            }
            return 0;
        },

        simplifyName(name) {
            return name
                .replace('已读帖子（所有时间）', '已读帖子')
                .replace('浏览的话题（所有时间）', '浏览话题')
                .replace('获赞：点赞用户数量', '点赞用户')
                .replace('获赞：单日最高数量', '获赞天数')
                .replace('被禁言（过去 6 个月）', '禁言')
                .replace('被封禁（过去 6 个月）', '封禁')
                .replace('发帖数量', '发帖')
                .replace('回复数量', '回复')
                .replace('被举报的帖子（过去 6 个月）', '被举报帖子')
                .replace('发起举报的用户（过去 6 个月）', '发起举报');
        },

        formatDate(ts, format = 'short') {
            const d = new Date(ts);
            const month = d.getMonth() + 1;
            const day = d.getDate();
            if (format === 'short') return `${month}/${day}`;
            if (format === 'time') return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `${month}月${day}日`;
        },

        getTodayKey() {
            return new Date().toDateString();
        },

        formatReadingTime(minutes) {
            if (minutes < 1) return '< 1分钟';
            if (minutes < 60) return `${Math.round(minutes)}分钟`;
            const hours = Math.floor(minutes / 60);
            const mins = Math.round(minutes % 60);
            return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
        },

        getReadingLevel(minutes) {
            const levels = CONFIG.READING_LEVELS;
            for (let i = levels.length - 1; i >= 0; i--) {
                if (minutes >= levels[i].min) return levels[i];
            }
            return levels[0];
        },

        getHeatmapLevel(minutes) {
            if (minutes < 1) return 0;
            if (minutes <= 30) return 1;
            if (minutes <= 90) return 2;
            if (minutes <= 180) return 3;
            return 4;
        },

        reorderRequirements(reqs) {
            const reportItems = [];
            const otherItems = [];

            reqs.forEach(r => {
                if (r.name.includes('被举报') || r.name.includes('发起举报')) {
                    reportItems.push(r);
                } else {
                    otherItems.push(r);
                }
            });

            const banIndex = otherItems.findIndex(r => r.name.includes('禁言'));
            if (banIndex >= 0) {
                otherItems.splice(banIndex, 0, ...reportItems);
            } else {
                otherItems.push(...reportItems);
            }

            return otherItems;
        },

        debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }
    };

    // ==================== 通知管理器 ====================
    class NotificationManager {
        constructor(storage) {
            this.storage = storage;
        }

        check(requirements) {
            const achieved = this.storage.get('milestones', {});
            const newMilestones = [];

            requirements.forEach(req => {
                for (const [key, thresholds] of Object.entries(CONFIG.MILESTONES)) {
                    if (req.name.includes(key)) {
                        thresholds.forEach(t => {
                            const k = `${key}_${t}`;
                            if (req.currentValue >= t && !achieved[k]) {
                                newMilestones.push({ name: key, threshold: t });
                                achieved[k] = true;
                            }
                        });
                    }
                }
                const k = `req_${req.name}`;
                if (req.isSuccess && !achieved[k]) {
                    newMilestones.push({ name: req.name, type: 'req' });
                    achieved[k] = true;
                }
            });

            if (newMilestones.length > 0) {
                this.storage.set('milestones', achieved);
                this.notify(newMilestones);
            }
        }

        notify(milestones) {
            const last = this.storage.get('lastNotify', 0);
            if (Date.now() - last < 60000) return;
            this.storage.set('lastNotify', Date.now());

            const msg = milestones.slice(0, 3).map(m =>
                m.type === 'req' ? `✅ ${m.name}` : `🏆 ${m.name} → ${m.threshold}`
            ).join('\n');

            if (typeof GM_notification !== 'undefined') {
                GM_notification({ title: '🎉 达成里程碑！', text: msg, timeout: 5000 });
            }

            return milestones;
        }
    }

    // ==================== 样式生成器 ====================
    const StyleGenerator = {
        generate() {
            const config = getPanelConfig();
            return `
            #ldsp-panel {
                --duration-fast: 150ms;
                --duration-normal: 250ms;
                --duration-slow: 400ms;
                --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
                --ease-in-out-circ: cubic-bezier(0.85, 0, 0.15, 1);
                --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

                --bg-base: #0f0f1a;
                --bg-card: #1a1a2e;
                --bg-card-hover: #252542;
                --bg-elevated: #16213e;
                --bg-input: #0f0f1a;
                --text-primary: #eaeaea;
                --text-secondary: #a0a0b0;
                --text-muted: #6a6a7a;
                --accent-primary: #7c3aed;
                --accent-primary-hover: #8b5cf6;
                --accent-secondary: #06b6d4;
                --accent-gradient: linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%);

                --color-success-50: #f0fdf4;
                --color-success-100: #dcfce7;
                --color-success-500: #22c55e;
                --color-success-600: #16a34a;
                --color-success-700: #15803d;
                --color-danger-50: #fef2f2;
                --color-danger-100: #fee2e2;
                --color-danger-500: #ef4444;
                --color-danger-600: #dc2626;
                --color-danger-700: #b91c1c;

                --success: var(--color-success-500);
                --success-bg: rgba(34, 197, 94, 0.15);
                --success-border: rgba(34, 197, 94, 0.3);
                --danger: var(--color-danger-500);
                --danger-bg: rgba(239, 68, 68, 0.15);
                --danger-border: rgba(239, 68, 68, 0.3);
                --warning: #f59e0b;
                --info: #3b82f6;

                --border-subtle: rgba(255, 255, 255, 0.06);
                --border-default: rgba(255, 255, 255, 0.1);
                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
                --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
                --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.5);
                --radius-sm: 6px;
                --radius-md: 10px;
                --radius-lg: 14px;

                --panel-width: ${config.width}px;
                --panel-max-height: ${config.maxHeight}px;
                --panel-font-size: ${config.fontSize}px;
                --panel-padding: ${config.padding}px;
                --avatar-size: ${config.avatarSize}px;
                --ring-size: ${config.ringSize}px;

                position: fixed;
                left: 12px;
                top: 80px;
                width: var(--panel-width);
                background: var(--bg-base);
                border-radius: var(--radius-lg);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
                font-size: var(--panel-font-size);
                color: var(--text-primary);
                box-shadow: var(--shadow-lg);
                z-index: 99999;
                overflow: hidden;
                border: 1px solid var(--border-subtle);
                transform-origin: left center;
            }

            #ldsp-panel,
            #ldsp-panel *,
            #ldsp-panel *::before,
            #ldsp-panel *::after {
                transition-property: background-color, background, color, border-color, box-shadow, opacity, transform;
                transition-duration: var(--duration-normal);
                transition-timing-function: ease-out;
            }

            #ldsp-panel.no-transition,
            #ldsp-panel.no-transition *,
            #ldsp-panel.no-transition *::before,
            #ldsp-panel.no-transition *::after {
                transition: none !important;
            }

            #ldsp-panel.animating {
                transition: width var(--duration-slow) var(--ease-out-expo),
                            height var(--duration-slow) var(--ease-out-expo),
                            border-radius var(--duration-normal) var(--ease-in-out-circ),
                            left var(--duration-slow) var(--ease-out-expo),
                            top var(--duration-slow) var(--ease-out-expo);
            }

            #ldsp-panel.light {
                --bg-base: #ffffff;
                --bg-card: #f8fafc;
                --bg-card-hover: #f1f5f9;
                --bg-elevated: #ffffff;
                --bg-input: #f1f5f9;
                --text-primary: #1e293b;
                --text-secondary: #64748b;
                --text-muted: #94a3b8;
                --accent-primary: #6366f1;
                --accent-primary-hover: #4f46e5;
                --accent-secondary: #0ea5e9;
                --accent-gradient: linear-gradient(135deg, #6366f1 0%, #0ea5e9 100%);
                --success: var(--color-success-600);
                --success-bg: rgba(22, 163, 74, 0.1);
                --success-border: rgba(22, 163, 74, 0.2);
                --danger: var(--color-danger-600);
                --danger-bg: rgba(220, 38, 38, 0.1);
                --danger-border: rgba(220, 38, 38, 0.2);
                --border-subtle: rgba(0, 0, 0, 0.04);
                --border-default: rgba(0, 0, 0, 0.08);
                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
                --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.1);
                --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.12);
            }

            #ldsp-panel.collapsed {
                width: 44px !important;
                height: 44px !important;
                border-radius: var(--radius-md);
                cursor: move;
                background: var(--accent-gradient);
                border: none;
            }

            #ldsp-panel.collapsed.animating {
                animation: collapse-bounce var(--duration-slow) var(--ease-spring);
            }

            @keyframes collapse-bounce {
                0% { transform: scale(1); }
                50% { transform: scale(0.95); }
                100% { transform: scale(1); }
            }

            #ldsp-panel.collapsed .ldsp-header {
                padding: 0;
                justify-content: center;
                height: 44px;
                background: transparent;
            }

            #ldsp-panel.collapsed .ldsp-header-info,
            #ldsp-panel.collapsed .ldsp-header-btns > button:not(.ldsp-btn-toggle),
            #ldsp-panel.collapsed .ldsp-body {
                display: none !important;
            }

            #ldsp-panel.collapsed .ldsp-btn-toggle {
                width: 44px;
                height: 44px;
                font-size: 18px;
                background: transparent;
                border-radius: var(--radius-md);
                cursor: pointer;
            }

            #ldsp-panel.collapsed .ldsp-btn-toggle:hover {
                background: rgba(255, 255, 255, 0.1);
            }

            #ldsp-panel.expand-left {
                transform-origin: right center;
            }

            #ldsp-panel.expand-right {
                transform-origin: left center;
            }

            .ldsp-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--panel-padding);
                background: var(--accent-gradient);
                cursor: move;
                user-select: none;
            }

            .ldsp-header-info {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .ldsp-site-icon {
                width: 22px;
                height: 22px;
                border-radius: 50%;
                object-fit: cover;
                flex-shrink: 0;
                border: 2px solid rgba(255, 255, 255, 0.3);
                background: rgba(255, 255, 255, 0.1);
            }

            .ldsp-title {
                font-weight: 700;
                font-size: 13px;
                color: #fff;
                letter-spacing: 0.3px;
            }

            .ldsp-version {
                font-size: 9px;
                color: rgba(255, 255, 255, 0.8);
                background: rgba(255, 255, 255, 0.2);
                padding: 2px 5px;
                border-radius: 6px;
                font-weight: 500;
            }

            .ldsp-header-btns {
                display: flex;
                gap: 4px;
            }

            .ldsp-header-btns button {
                width: 26px;
                height: 26px;
                border: none;
                background: rgba(255, 255, 255, 0.15);
                color: #fff;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
            }

            .ldsp-header-btns button:hover {
                background: rgba(255, 255, 255, 0.25);
                transform: translateY(-1px);
            }

            .ldsp-header-btns button:active {
                transform: translateY(0);
            }

            .ldsp-header-btns button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
            }

            .ldsp-header-btns button:disabled:hover {
                background: rgba(255, 255, 255, 0.15);
                transform: none;
            }

            .ldsp-header-btns button::after {
                content: '';
                position: absolute;
                inset: 0;
                background: radial-gradient(circle at center, rgba(255,255,255,0.3) 0%, transparent 70%);
                transform: scale(0);
                opacity: 0;
            }

            .ldsp-header-btns button:active::after {
                animation: ripple 0.4s ease-out;
            }

            @keyframes ripple {
                0% { transform: scale(0); opacity: 1; }
                100% { transform: scale(2); opacity: 0; }
            }

            .ldsp-header-btns button:focus-visible,
            .ldsp-tab:focus-visible,
            .ldsp-subtab:focus-visible {
                outline: 2px solid rgba(255, 255, 255, 0.5);
                outline-offset: 2px;
            }

            .ldsp-body {
                background: var(--bg-base);
            }

            .ldsp-user {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: var(--panel-padding);
                background: var(--bg-card);
                border-bottom: 1px solid var(--border-subtle);
            }

            .ldsp-avatar {
                width: var(--avatar-size);
                height: var(--avatar-size);
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid var(--accent-primary);
                flex-shrink: 0;
                background: var(--bg-elevated);
            }

            .ldsp-avatar:hover {
                transform: scale(1.05);
                border-color: var(--accent-secondary);
            }

            .ldsp-avatar-placeholder {
                width: var(--avatar-size);
                height: var(--avatar-size);
                border-radius: 50%;
                background: var(--accent-gradient);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                color: #fff;
                flex-shrink: 0;
            }

            .ldsp-user-info {
                flex: 1;
                min-width: 0;
            }

            .ldsp-user-name {
                font-weight: 600;
                font-size: 13px;
                color: var(--text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .ldsp-user-meta {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 3px;
            }

            .ldsp-user-level {
                font-size: 9px;
                font-weight: 700;
                color: #fff;
                background: var(--accent-gradient);
                padding: 2px 6px;
                border-radius: 10px;
                letter-spacing: 0.3px;
            }

            .ldsp-user-status {
                font-size: 9px;
                color: var(--text-muted);
            }

            .ldsp-reading-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 6px 10px;
                border-radius: var(--radius-md);
                min-width: 70px;
                position: relative;
                overflow: hidden;
            }

            .ldsp-reading-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                opacity: 0.1;
            }

            .ldsp-reading-card:hover::before {
                opacity: 0.2;
            }

            .ldsp-reading-icon {
                font-size: 18px;
                margin-bottom: 2px;
                animation: ldsp-bounce 2s ease-in-out infinite;
            }

            @keyframes ldsp-bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-3px); }
            }

            .ldsp-reading-time {
                font-size: 12px;
                font-weight: 800;
                letter-spacing: -0.3px;
            }

            .ldsp-reading-label {
                font-size: 8px;
                opacity: 0.8;
                margin-top: 1px;
            }

            .ldsp-reading-card.level-high .ldsp-reading-icon {
                animation: ldsp-fire 0.5s ease-in-out infinite;
            }

            @keyframes ldsp-fire {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }

            .ldsp-reading-card.level-max .ldsp-reading-icon {
                animation: ldsp-crown 1s ease-in-out infinite;
            }

            @keyframes ldsp-crown {
                0%, 100% { transform: rotate(-5deg) scale(1); }
                50% { transform: rotate(5deg) scale(1.15); }
            }

            .ldsp-status {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px var(--panel-padding);
                font-size: 11px;
                font-weight: 500;
                background: var(--bg-card);
                border-bottom: 1px solid var(--border-subtle);
            }

            .ldsp-status.success {
                color: var(--success);
                background: var(--success-bg);
            }

            .ldsp-status.fail {
                color: var(--danger);
                background: var(--danger-bg);
            }

            .ldsp-tabs {
                display: flex;
                padding: 8px 10px;
                gap: 6px;
                background: var(--bg-base);
                border-bottom: 1px solid var(--border-subtle);
            }

            .ldsp-tab {
                flex: 1;
                padding: 6px 10px;
                border: none;
                background: var(--bg-card);
                color: var(--text-secondary);
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
            }

            .ldsp-tab:hover {
                background: var(--bg-card-hover);
                color: var(--text-primary);
            }

            .ldsp-tab.active {
                background: var(--accent-primary);
                color: #fff;
            }

            .ldsp-content {
                max-height: calc(var(--panel-max-height) - 180px);
                overflow-y: auto;
                overflow-x: hidden;
                scrollbar-width: thin;
                scrollbar-color: var(--border-default) transparent;
            }

            .ldsp-content::-webkit-scrollbar {
                width: 5px;
            }

            .ldsp-content::-webkit-scrollbar-thumb {
                background: var(--border-default);
                border-radius: 3px;
            }

            .ldsp-content::-webkit-scrollbar-thumb:hover {
                background: var(--accent-primary);
            }

            .ldsp-panel-section {
                display: none;
                padding: 8px;
            }

            .ldsp-panel-section.active {
                display: block;
                animation: section-enter var(--duration-normal) var(--ease-out-expo);
            }

            @keyframes section-enter {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .ldsp-progress-ring {
                display: flex;
                justify-content: center;
                padding: 10px;
                background: var(--bg-card);
                border-radius: var(--radius-md);
                margin-bottom: 8px;
            }

            .ldsp-ring-wrap {
                position: relative;
                width: var(--ring-size);
                height: var(--ring-size);
            }

            .ldsp-ring-wrap svg {
                transform: rotate(-90deg);
                width: 100%;
                height: 100%;
            }

            .ldsp-ring-bg {
                fill: none;
                stroke: var(--bg-elevated);
                stroke-width: 6;
            }

            .ldsp-ring-fill {
                fill: none;
                stroke: url(#ldsp-gradient);
                stroke-width: 6;
                stroke-linecap: round;
                transition: stroke-dashoffset 0.8s var(--ease-out-expo);
            }

            .ldsp-ring-fill.animate {
                animation: ring-fill-animation 1.2s var(--ease-out-expo) forwards;
            }

            @keyframes ring-fill-animation {
                from {
                    stroke-dashoffset: var(--ring-circumference);
                    filter: brightness(1);
                }
                50% {
                    filter: brightness(1.3) drop-shadow(0 0 8px var(--accent-primary));
                }
                to {
                    stroke-dashoffset: var(--ring-target-offset);
                    filter: brightness(1);
                }
            }

            .ldsp-ring-text {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
            }

            .ldsp-ring-value {
                font-size: 18px;
                font-weight: 800;
                background: var(--accent-gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }

            .ldsp-ring-value.animate {
                animation: ring-value-animation 0.8s var(--ease-out-expo) 0.4s forwards;
                opacity: 0;
            }

            @keyframes ring-value-animation {
                from {
                    opacity: 0;
                    transform: scale(0.5);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }

            .ldsp-ring-label {
                font-size: 9px;
                color: var(--text-muted);
                margin-top: 2px;
            }

            .ldsp-item {
                display: flex;
                align-items: center;
                padding: 6px 8px;
                margin-bottom: 4px;
                background: var(--bg-card);
                border-radius: var(--radius-sm);
                border-left: 3px solid var(--border-default);
                position: relative;
                overflow: hidden;
                animation: item-enter var(--duration-normal) var(--ease-out-expo) backwards;
            }

            .ldsp-item:nth-child(1) { animation-delay: 0ms; }
            .ldsp-item:nth-child(2) { animation-delay: 30ms; }
            .ldsp-item:nth-child(3) { animation-delay: 60ms; }
            .ldsp-item:nth-child(4) { animation-delay: 90ms; }
            .ldsp-item:nth-child(5) { animation-delay: 120ms; }
            .ldsp-item:nth-child(6) { animation-delay: 150ms; }
            .ldsp-item:nth-child(7) { animation-delay: 180ms; }
            .ldsp-item:nth-child(8) { animation-delay: 210ms; }
            .ldsp-item:nth-child(9) { animation-delay: 240ms; }
            .ldsp-item:nth-child(10) { animation-delay: 270ms; }
            .ldsp-item:nth-child(11) { animation-delay: 300ms; }
            .ldsp-item:nth-child(12) { animation-delay: 330ms; }

            @keyframes item-enter {
                from { opacity: 0; transform: translateX(-10px); }
                to { opacity: 1; transform: translateX(0); }
            }

            .ldsp-item::before {
                content: '';
                position: absolute;
                left: 0;
                top: 0;
                height: 100%;
                width: 3px;
                background: var(--accent-primary);
                transform: scaleY(0);
            }

            .ldsp-item:hover {
                background: var(--bg-card-hover);
                transform: translateX(3px);
            }

            .ldsp-item:hover::before {
                transform: scaleY(1);
            }

            .ldsp-item:last-child {
                margin-bottom: 0;
            }

            .ldsp-item.success {
                border-left-color: var(--success);
                background: var(--success-bg);
            }

            .ldsp-item.fail {
                border-left-color: var(--danger);
                background: var(--danger-bg);
            }

            .ldsp-item-icon {
                font-size: 11px;
                margin-right: 6px;
                opacity: 0.9;
            }

            .ldsp-item-name {
                flex: 1;
                font-size: 10px;
                color: var(--text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .ldsp-item.success .ldsp-item-name {
                color: var(--success);
            }

            .ldsp-item.fail .ldsp-item-name {
                color: var(--text-secondary);
            }

            .ldsp-item-values {
                display: flex;
                align-items: center;
                gap: 2px;
                font-size: 11px;
                font-weight: 700;
                margin-left: 6px;
            }

            .ldsp-item-current {
                color: var(--text-primary);
            }

            .ldsp-item-current.updating {
                animation: value-update 0.6s var(--ease-out-expo);
            }

            @keyframes value-update {
                0% { transform: scale(1); background: transparent; }
                30% { transform: scale(1.2); background: var(--accent-primary); color: white; border-radius: 4px; }
                100% { transform: scale(1); background: transparent; }
            }

            .ldsp-item.success .ldsp-item-current {
                color: var(--success);
            }

            .ldsp-item.fail .ldsp-item-current {
                color: var(--danger);
            }

            .ldsp-item-sep {
                color: var(--text-muted);
                font-weight: 400;
            }

            .ldsp-item-required {
                color: var(--text-muted);
                font-weight: 500;
            }

            .ldsp-item-change {
                font-size: 9px;
                padding: 1px 4px;
                border-radius: 4px;
                font-weight: 700;
                margin-left: 4px;
                animation: change-pop var(--duration-normal) var(--ease-spring);
            }

            @keyframes change-pop {
                0% { transform: scale(0); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }

            .ldsp-item-change.up {
                background: var(--success-bg);
                color: var(--success);
            }

            .ldsp-item-change.down {
                background: var(--danger-bg);
                color: var(--danger);
            }

            .ldsp-subtabs {
                display: flex;
                gap: 4px;
                padding: 0 0 10px 0;
                overflow-x: auto;
                overflow-y: hidden;
                scrollbar-width: thin;
                scrollbar-color: var(--border-default) transparent;
            }

            .ldsp-subtabs::-webkit-scrollbar {
                height: 3px;
            }

            .ldsp-subtabs::-webkit-scrollbar-thumb {
                background: var(--border-default);
                border-radius: 2px;
            }

            .ldsp-subtab {
                padding: 5px 10px;
                border: 1px solid var(--border-default);
                background: var(--bg-card);
                color: var(--text-secondary);
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 10px;
                font-weight: 600;
                white-space: nowrap;
                flex-shrink: 0;
            }

            .ldsp-subtab:hover {
                border-color: var(--accent-primary);
                color: var(--accent-primary);
                background: var(--bg-card-hover);
            }

            .ldsp-subtab.active {
                background: var(--accent-primary);
                border-color: var(--accent-primary);
                color: #fff;
            }

            .ldsp-chart {
                background: var(--bg-card);
                border-radius: var(--radius-md);
                padding: 10px;
                margin-bottom: 8px;
            }

            .ldsp-chart:last-child {
                margin-bottom: 0;
            }

            .ldsp-chart-title {
                font-size: 11px;
                font-weight: 700;
                margin-bottom: 10px;
                color: var(--text-primary);
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .ldsp-chart-subtitle {
                font-size: 9px;
                color: var(--text-muted);
                font-weight: 500;
                margin-left: auto;
            }

            .ldsp-spark-row {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 8px;
            }

            .ldsp-spark-row:last-child {
                margin-bottom: 0;
            }

            .ldsp-spark-label {
                width: 55px;
                font-size: 9px;
                color: var(--text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: 500;
            }

            .ldsp-spark-bars {
                flex: 1;
                display: flex;
                align-items: flex-end;
                gap: 2px;
                height: 22px;
            }

            .ldsp-spark-bar {
                flex: 1;
                background: var(--accent-primary);
                border-radius: 2px 2px 0 0;
                min-height: 2px;
                opacity: 0.4;
                position: relative;
            }

            .ldsp-spark-bar:last-child {
                opacity: 1;
            }

            .ldsp-spark-bar:hover {
                opacity: 1;
                transform: scaleY(1.1);
            }

            .ldsp-spark-bar::after {
                content: attr(data-value);
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                font-size: 8px;
                color: var(--text-primary);
                background: var(--bg-elevated);
                padding: 2px 3px;
                border-radius: 2px;
                opacity: 0;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: var(--shadow-sm);
            }

            .ldsp-spark-bar:hover::after {
                opacity: 1;
            }

            .ldsp-spark-val {
                font-size: 10px;
                font-weight: 700;
                color: var(--text-primary);
                min-width: 30px;
                text-align: right;
            }

            .ldsp-date-labels {
                display: flex;
                justify-content: space-between;
                padding: 6px 0 0 60px;
                margin-right: 35px;
            }

            .ldsp-date-label {
                font-size: 8px;
                color: var(--text-muted);
                text-align: center;
            }

            .ldsp-changes {
                margin-top: 6px;
            }

            .ldsp-change-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 5px 0;
                border-bottom: 1px solid var(--border-subtle);
            }

            .ldsp-change-row:last-child {
                border-bottom: none;
            }

            .ldsp-change-name {
                font-size: 10px;
                color: var(--text-secondary);
            }

            .ldsp-change-val {
                font-size: 10px;
                font-weight: 700;
                padding: 2px 6px;
                border-radius: 4px;
            }

            .ldsp-change-val.up {
                background: var(--success-bg);
                color: var(--success);
            }

            .ldsp-change-val.down {
                background: var(--danger-bg);
                color: var(--danger);
            }

            .ldsp-change-val.neutral {
                background: var(--bg-elevated);
                color: var(--text-muted);
            }

            .ldsp-reading-stats {
                background: var(--bg-card);
                border-radius: var(--radius-md);
                padding: 10px;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .ldsp-reading-stats-icon {
                font-size: 28px;
                flex-shrink: 0;
            }

            .ldsp-reading-stats-info {
                flex: 1;
            }

            .ldsp-reading-stats-value {
                font-size: 16px;
                font-weight: 800;
                background: var(--accent-gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }

            .ldsp-reading-stats-label {
                font-size: 10px;
                color: var(--text-muted);
                margin-top: 2px;
            }

            .ldsp-reading-stats-badge {
                padding: 3px 8px;
                border-radius: 10px;
                font-size: 9px;
                font-weight: 700;
            }

            .ldsp-tracking-indicator {
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 5px 8px;
                background: var(--bg-card);
                border-radius: var(--radius-sm);
                margin-bottom: 8px;
                font-size: 9px;
                color: var(--text-muted);
            }

            .ldsp-tracking-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: var(--success);
                animation: ldsp-pulse 2s ease-in-out infinite;
            }

            @keyframes ldsp-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(0.9); }
            }

            .ldsp-tracking-indicator.paused .ldsp-tracking-dot {
                background: var(--warning);
                animation: none;
            }

            .ldsp-reading-progress {
                background: var(--bg-card);
                border-radius: var(--radius-md);
                padding: 10px;
                margin-bottom: 8px;
            }

            .ldsp-reading-progress-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }

            .ldsp-reading-progress-title {
                font-size: 10px;
                color: var(--text-secondary);
                font-weight: 600;
            }

            .ldsp-reading-progress-value {
                font-size: 11px;
                font-weight: 700;
                color: var(--text-primary);
            }

            .ldsp-reading-progress-bar {
                height: 6px;
                background: var(--bg-elevated);
                border-radius: 3px;
                overflow: hidden;
            }

            .ldsp-reading-progress-fill {
                height: 100%;
                border-radius: 3px;
            }

            .ldsp-reading-week {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                height: 50px;
                padding: 0 2px;
                margin: 10px 0 6px;
                gap: 2px;
            }

            .ldsp-reading-day {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 3px;
                min-width: 0;
            }

            .ldsp-reading-day-bar {
                width: 100%;
                max-width: 16px;
                background: linear-gradient(to top, #7c3aed, #06b6d4);
                border-radius: 2px 2px 0 0;
                min-height: 2px;
                cursor: pointer;
                position: relative;
            }

            .ldsp-reading-day-bar:hover {
                transform: scaleX(1.15);
                opacity: 0.9;
            }

            .ldsp-reading-day-bar::after {
                content: attr(data-time);
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: var(--bg-elevated);
                color: var(--text-primary);
                padding: 2px 4px;
                border-radius: 2px;
                font-size: 7px;
                font-weight: 600;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                box-shadow: var(--shadow-sm);
                margin-bottom: 3px;
            }

            .ldsp-reading-day-bar:hover::after {
                opacity: 1;
            }

            .ldsp-reading-day-label {
                font-size: 7px;
                color: var(--text-muted);
                line-height: 1;
            }

            .ldsp-today-stats {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 6px;
                margin-bottom: 8px;
            }

            .ldsp-today-stat {
                background: var(--bg-card);
                border-radius: var(--radius-sm);
                padding: 8px;
                text-align: center;
            }

            .ldsp-today-stat-value {
                font-size: 16px;
                font-weight: 800;
                background: var(--accent-gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }

            .ldsp-today-stat-label {
                font-size: 9px;
                color: var(--text-muted);
                margin-top: 2px;
            }

            .ldsp-time-info {
                font-size: 9px;
                color: var(--text-muted);
                text-align: center;
                padding: 6px;
                background: var(--bg-card);
                border-radius: var(--radius-sm);
                margin-bottom: 8px;
            }

            .ldsp-time-info span {
                color: var(--accent-primary);
                font-weight: 600;
            }

            .ldsp-year-heatmap-container {
                padding: 8px 12px 8px 0;
                overflow-x: hidden;
                overflow-y: auto;
                max-height: 300px;
            }

            .ldsp-year-heatmap-wrapper {
                display: flex;
                flex-direction: column;
                gap: 2px;
                width: 100%;
                padding-right: 4px;
            }

            .ldsp-year-heatmap-month-row {
                display: flex;
                align-items: center;
                gap: 4px;
                width: 100%;
                position: relative;
            }

            .ldsp-year-month-label {
                width: 26px;
                font-size: 7px;
                font-weight: 600;
                color: var(--text-muted);
                text-align: right;
                flex-shrink: 0;
                line-height: 1;
                position: absolute;
                left: 0;
                top: 50%;
                transform: translateY(-50%);
            }

            .ldsp-year-heatmap-cells {
                display: grid;
                grid-template-columns: repeat(14, minmax(8px, 1fr));
                gap: 3px;
                width: 100%;
                align-items: center;
                margin-left: 30px;
            }

            .ldsp-year-heatmap-cell {
                width: 100%;
                aspect-ratio: 1;
                border-radius: 2px;
                background: var(--bg-card);
                border: 0.5px solid var(--border-subtle);
                cursor: pointer;
                position: relative;
            }

            .ldsp-year-heatmap-cell:hover {
                transform: scale(1.5);
                box-shadow: 0 0 6px rgba(124, 58, 237, 0.4);
                border-color: var(--accent-primary);
                z-index: 10;
            }

            .ldsp-year-heatmap-cell.level-0 { background: rgba(124, 58, 237, 0.08); border-color: rgba(124, 58, 237, 0.15); }
            .ldsp-year-heatmap-cell.level-1 { background: rgba(124, 58, 237, 0.25); border-color: rgba(124, 58, 237, 0.35); }
            .ldsp-year-heatmap-cell.level-2 { background: rgba(124, 58, 237, 0.45); border-color: rgba(124, 58, 237, 0.55); }
            .ldsp-year-heatmap-cell.level-3 { background: rgba(124, 58, 237, 0.65); border-color: rgba(124, 58, 237, 0.75); }
            .ldsp-year-heatmap-cell.level-4 { background: var(--accent-primary); border-color: var(--accent-primary); }

            .ldsp-year-heatmap-cell.empty {
                background: transparent;
                border-color: transparent;
                cursor: default;
            }

            .ldsp-year-heatmap-cell.empty:hover {
                transform: none;
                box-shadow: none;
            }

            .ldsp-year-heatmap-tooltip {
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                background: var(--bg-elevated);
                color: var(--text-primary);
                padding: 4px 7px;
                border-radius: 2px;
                font-size: 7px;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                border: 1px solid var(--border-default);
                z-index: 1000;
                line-height: 1.2;
            }

            .ldsp-year-heatmap-cell:hover .ldsp-year-heatmap-tooltip {
                opacity: 1;
            }

            .ldsp-year-heatmap-cell .ldsp-year-heatmap-tooltip {
                bottom: 100%;
                margin-bottom: 2px;
            }

            .ldsp-year-heatmap-month-row:nth-child(-n+3) .ldsp-year-heatmap-tooltip {
                bottom: auto;
                top: 100%;
                margin-top: 2px;
                margin-bottom: 0;
            }

            .ldsp-year-heatmap-cell:nth-child(13) .ldsp-year-heatmap-tooltip,
            .ldsp-year-heatmap-cell:nth-child(14) .ldsp-year-heatmap-tooltip {
                left: auto;
                right: 0;
                transform: translateX(0);
            }

            .ldsp-heatmap-legend {
                display: flex;
                align-items: center;
                gap: 4px;
                justify-content: center;
                font-size: 7px;
                color: var(--text-muted);
                padding: 4px 0;
            }

            .ldsp-heatmap-legend-cell {
                width: 7px;
                height: 7px;
                border-radius: 1px;
                border: 0.5px solid var(--border-subtle);
            }

            .ldsp-empty, .ldsp-loading {
                text-align: center;
                padding: 24px 14px;
                color: var(--text-muted);
            }

            .ldsp-empty-icon {
                font-size: 32px;
                margin-bottom: 8px;
            }

            .ldsp-empty-text {
                font-size: 11px;
                line-height: 1.6;
            }

            .ldsp-spinner {
                width: 24px;
                height: 24px;
                border: 3px solid var(--border-default);
                border-top-color: var(--accent-primary);
                border-radius: 50%;
                animation: ldsp-spin 0.8s linear infinite;
                margin: 0 auto 8px;
            }

            @keyframes ldsp-spin {
                to { transform: rotate(360deg); }
            }

            .ldsp-mini-loader {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px 20px;
                color: var(--text-muted);
            }

            .ldsp-mini-spinner {
                width: 28px;
                height: 28px;
                border: 3px solid var(--border-default);
                border-top-color: var(--accent-primary);
                border-radius: 50%;
                animation: ldsp-spin 0.8s linear infinite;
                margin-bottom: 12px;
            }

            .ldsp-mini-loader-text {
                font-size: 10px;
                color: var(--text-muted);
            }

            .ldsp-toast {
                position: absolute;
                bottom: -50px;
                left: 50%;
                transform: translateX(-50%) translateY(10px);
                background: var(--accent-gradient);
                color: #fff;
                padding: 8px 14px;
                border-radius: var(--radius-md);
                font-size: 11px;
                font-weight: 600;
                box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4);
                opacity: 0;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 6px;
                z-index: 100000;
            }

            .ldsp-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }

            .ldsp-no-change {
                text-align: center;
                padding: 14px;
                color: var(--text-muted);
                font-size: 10px;
            }

            @media (prefers-reduced-motion: reduce) {
                #ldsp-panel,
                #ldsp-panel * {
                    animation-duration: 0.01ms !important;
                    transition-duration: 0.01ms !important;
                }
            }

            @media (prefers-contrast: high) {
                #ldsp-panel {
                    --border-subtle: rgba(255, 255, 255, 0.3);
                    --border-default: rgba(255, 255, 255, 0.5);
                }

                .ldsp-item {
                    border-left-width: 4px;
                }
            }

            @media (max-height: 700px) {
                #ldsp-panel {
                    top: 60px;
                }
                .ldsp-content {
                    max-height: calc(100vh - 240px);
                }
            }

            @media (max-width: 1200px) {
                #ldsp-panel {
                    left: 8px;
                }
            }
        `;
        }
    };

    // ==================== 面板渲染器 ====================
    class PanelRenderer {
        constructor(panel) {
            this.panel = panel;
            this.prevValues = new Map();
            this.lastPct = -1; // 初始化为-1，确保首次渲染时触发动画
        }

        renderUser(name, level, isOK, reqs) {
            const done = reqs.filter(r => r.isSuccess).length;
            this.panel.$.userName.textContent = name;
            this.panel.$.userLevel.textContent = `Lv ${level}`;
            this.panel.$.userStatus.textContent = `${done}/${reqs.length} 完成`;
            this.panel.$.status.className = `ldsp-status ${isOK ? 'success' : 'fail'}`;
            this.panel.$.status.innerHTML = `<span>${isOK ? '✅' : '⏳'}</span><span>${isOK ? '已' : '未'}满足升级要求</span>`;
        }

        renderReqs(reqs) {
            const done = reqs.filter(r => r.isSuccess).length;
            const pct = Math.round(done / reqs.length * 100);
            const config = getPanelConfig();
            const ringSize = config.ringSize;
            const ringRadius = (ringSize / 2) - 8;
            const circumference = 2 * Math.PI * ringRadius;
            const targetOffset = circumference * (1 - pct / 100);

            // 判断是否需要动画：首次渲染、百分比变化、或手动刷新时
            const shouldAnimate = this.lastPct === -1 || this.lastPct !== pct || this.panel.shouldAnimateRing;
            this.lastPct = pct;
            this.panel.shouldAnimateRing = false;

            let html = `
                <div class="ldsp-progress-ring">
                    <div class="ldsp-ring-wrap">
                        <svg width="${ringSize}" height="${ringSize}" viewBox="0 0 ${ringSize} ${ringSize}">
                            <defs>
                                <linearGradient id="ldsp-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:#7c3aed"/>
                                    <stop offset="100%" style="stop-color:#06b6d4"/>
                                </linearGradient>
                            </defs>
                            <circle class="ldsp-ring-bg" cx="${ringSize/2}" cy="${ringSize/2}" r="${ringRadius}"/>
                            <circle class="ldsp-ring-fill ${shouldAnimate ? 'animate' : ''}" cx="${ringSize/2}" cy="${ringSize/2}" r="${ringRadius}"
                                stroke-dasharray="${circumference}"
                                stroke-dashoffset="${shouldAnimate ? circumference : targetOffset}"
                                style="--ring-circumference: ${circumference}; --ring-target-offset: ${targetOffset};"/>
                        </svg>
                        <div class="ldsp-ring-text">
                            <div class="ldsp-ring-value ${shouldAnimate ? 'animate' : ''}">${pct}%</div>
                            <div class="ldsp-ring-label">完成度</div>
                        </div>
                    </div>
                </div>
            `;

            reqs.forEach(r => {
                const name = Utils.simplifyName(r.name);
                const icon = r.isSuccess ? '✓' : '○';
                let changeHtml = '';
                if (r.change !== 0) {
                    const cls = r.change > 0 ? 'up' : 'down';
                    changeHtml = `<span class="ldsp-item-change ${cls}">${r.change > 0 ? '+' : ''}${r.change}</span>`;
                }

                const prevValue = this.prevValues.get(r.name);
                const isUpdating = prevValue !== undefined && prevValue !== r.currentValue;
                const updateClass = isUpdating ? ' updating' : '';

                html += `
                    <div class="ldsp-item ${r.isSuccess ? 'success' : 'fail'}">
                        <span class="ldsp-item-icon">${icon}</span>
                        <span class="ldsp-item-name">${name}</span>
                        <div class="ldsp-item-values">
                            <span class="ldsp-item-current${updateClass}">${r.currentValue}</span>
                            <span class="ldsp-item-sep">/</span>
                            <span class="ldsp-item-required">${r.requiredValue}</span>
                        </div>
                        ${changeHtml}
                    </div>
                `;

                this.prevValues.set(r.name, r.currentValue);
            });

            this.panel.$.reqs.innerHTML = html;
        }

        renderReadingCard(minutes) {
            const level = Utils.getReadingLevel(minutes);
            const timeStr = Utils.formatReadingTime(minutes);

            this.panel.$.readingIcon.textContent = level.icon;
            this.panel.$.readingTime.textContent = timeStr;
            this.panel.$.readingLabel.textContent = level.label;

            this.panel.$.readingCard.style.background = level.bg;
            this.panel.$.readingCard.style.color = level.color;
            this.panel.$.readingTime.style.color = level.color;
            this.panel.$.readingLabel.style.color = level.color;

            this.panel.$.readingCard.classList.remove('level-high', 'level-max');
            if (minutes >= 450) {
                this.panel.$.readingCard.classList.add('level-max');
            } else if (minutes >= 180) {
                this.panel.$.readingCard.classList.add('level-high');
            }
        }

        renderAvatar(url) {
            const container = this.panel.$.user.querySelector('.ldsp-avatar-placeholder, .ldsp-avatar');
            if (container) {
                const img = document.createElement('img');
                img.className = 'ldsp-avatar';
                img.src = url;
                img.alt = 'Avatar';
                img.onerror = () => {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'ldsp-avatar-placeholder';
                    placeholder.textContent = '👤';
                    img.replaceWith(placeholder);
                };
                container.replaceWith(img);
            }
        }

        renderTrends(history, reqs, currentReadingTime, currentTab) {
            let html = `
                <div class="ldsp-subtabs" role="tablist">
                    <div class="ldsp-subtab ${currentTab === 'today' ? 'active' : ''}" data-trend="today" role="tab" aria-selected="${currentTab === 'today'}">☀️ 今日</div>
                    <div class="ldsp-subtab ${currentTab === 'week' ? 'active' : ''}" data-trend="week" role="tab" aria-selected="${currentTab === 'week'}">📅 本周</div>
                    <div class="ldsp-subtab ${currentTab === 'month' ? 'active' : ''}" data-trend="month" role="tab" aria-selected="${currentTab === 'month'}">📊 本月</div>
                    <div class="ldsp-subtab ${currentTab === 'year' ? 'active' : ''}" data-trend="year" role="tab" aria-selected="${currentTab === 'year'}">📈 本年</div>
                    <div class="ldsp-subtab ${currentTab === 'all' ? 'active' : ''}" data-trend="all" role="tab" aria-selected="${currentTab === 'all'}">🌐 全部</div>
                </div>
                <div class="ldsp-trend-content" role="tabpanel"></div>
            `;
            this.panel.$.trends.innerHTML = html;
        }

        renderLoading() {
            return `
                <div class="ldsp-mini-loader">
                    <div class="ldsp-mini-spinner"></div>
                    <div class="ldsp-mini-loader-text">加载数据中...</div>
                </div>
            `;
        }

        renderTodayTrend(reqs, currentReadingTime, todayData) {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();

            if (!todayData) {
                return `<div class="ldsp-empty"><div class="ldsp-empty-icon">☀️</div><div class="ldsp-empty-text">今日首次访问<br>数据将从现在开始统计</div></div>`;
            }

            const startTime = new Date(todayData.startTs);
            const startTimeStr = `${startTime.getHours()}:${String(startTime.getMinutes()).padStart(2, '0')}`;
            const currentTimeStr = `${hours}:${String(minutes).padStart(2, '0')}`;

            let html = `<div class="ldsp-time-info">今日 00:00 ~ ${currentTimeStr} (首次记录于 ${startTimeStr})</div>`;

            html += `
                <div class="ldsp-tracking-indicator">
                    <div class="ldsp-tracking-dot"></div>
                    <span>阅读时间追踪中...</span>
                </div>
            `;

            const todayReadingTime = currentReadingTime;
            const level = Utils.getReadingLevel(todayReadingTime);

            html += `
                <div class="ldsp-reading-stats">
                    <div class="ldsp-reading-stats-icon">${level.icon}</div>
                    <div class="ldsp-reading-stats-info">
                        <div class="ldsp-reading-stats-value">${Utils.formatReadingTime(todayReadingTime)}</div>
                        <div class="ldsp-reading-stats-label">今日累计阅读</div>
                    </div>
                    <div class="ldsp-reading-stats-badge" style="background: ${level.bg}; color: ${level.color};">${level.label}</div>
                </div>
            `;

            const maxMinutes = 600;
            const progressPct = Math.min(todayReadingTime / maxMinutes * 100, 100);

            html += `
                <div class="ldsp-reading-progress">
                    <div class="ldsp-reading-progress-header">
                        <span class="ldsp-reading-progress-title">📖 阅读目标 (10小时)</span>
                        <span class="ldsp-reading-progress-value">${Math.round(progressPct)}%</span>
                    </div>
                    <div class="ldsp-reading-progress-bar">
                        <div class="ldsp-reading-progress-fill" style="width: ${progressPct}%; background: ${level.bg.replace('0.15', '1')};"></div>
                    </div>
                </div>
            `;

            const changeList = [];
            reqs.forEach(r => {
                const startVal = todayData.startData[r.name] || 0;
                const diff = r.currentValue - startVal;
                if (diff !== 0) {
                    changeList.push({ name: Utils.simplifyName(r.name), diff, current: r.currentValue });
                }
            });

            const posChanges = changeList.filter(c => c.diff > 0).length;
            const negChanges = changeList.filter(c => c.diff < 0).length;

            html += `
                <div class="ldsp-today-stats">
                    <div class="ldsp-today-stat">
                        <div class="ldsp-today-stat-value">${posChanges}</div>
                        <div class="ldsp-today-stat-label">📈 增长项</div>
                    </div>
                    <div class="ldsp-today-stat">
                        <div class="ldsp-today-stat-value">${negChanges}</div>
                        <div class="ldsp-today-stat-label">📉 下降项</div>
                    </div>
                </div>
            `;

            if (changeList.length > 0) {
                let changes = '';
                changeList.sort((a, b) => b.diff - a.diff).forEach(c => {
                    const cls = c.diff > 0 ? 'up' : 'down';
                    changes += `
                        <div class="ldsp-change-row">
                            <span class="ldsp-change-name">${c.name}</span>
                            <span class="ldsp-change-val ${cls}">${c.diff > 0 ? '+' : ''}${c.diff}</span>
                        </div>
                    `;
                });
                html += `<div class="ldsp-chart"><div class="ldsp-chart-title">📊 今日变化明细</div><div class="ldsp-changes">${changes}</div></div>`;
            } else {
                html += `<div class="ldsp-no-change">今日暂无数据变化</div>`;
            }

            return html;
        }

        // 获取趋势数据的字段
        getTrendFields(reqs) {
            return CONFIG.TREND_FIELDS.map(field => {
                const req = reqs.find(r => r.name.includes(field.searchKey));
                return req ? { ...field, req, name: req.name } : null;
            }).filter(Boolean);
        }

        renderWeekTrend(history, reqs, historyManager, readingTracker) {
            const now = Date.now();
            const weekAgo = now - 7 * 24 * 3600000;
            const recent = history.filter(h => h.ts > weekAgo);

            if (recent.length < 1) {
                return `<div class="ldsp-empty"><div class="ldsp-empty-icon">📅</div><div class="ldsp-empty-text">本周数据不足<br>每天访问积累数据</div></div>`;
            }

            let html = this.renderReadingWeekChart(readingTracker);
            const dailyAggregates = historyManager.aggregateDailyIncrements(recent, reqs, 7);
            const trendFields = this.getTrendFields(reqs);
            const trends = [];

            trendFields.forEach(field => {
                const trendData = this.calculateDailyTrend(dailyAggregates, field.name, 7);
                if (trendData.values.some(v => v > 0)) {
                    trends.push({ label: field.label, ...trendData, current: field.req.currentValue });
                }
            });

            if (trends.length > 0) {
                html += `<div class="ldsp-chart"><div class="ldsp-chart-title">📈 本周每日增量<span class="ldsp-chart-subtitle">每日累积量</span></div>`;

                trends.forEach(t => {
                    const max = Math.max(...t.values, 1);
                    const bars = t.values.map((v) => {
                        const height = Math.max(v / max * 20, 2);
                        return `<div class="ldsp-spark-bar" style="height:${height}px" data-value="${v}"></div>`;
                    }).join('');
                    html += `
                        <div class="ldsp-spark-row">
                            <span class="ldsp-spark-label">${t.label}</span>
                            <div class="ldsp-spark-bars">${bars}</div>
                            <span class="ldsp-spark-val">${t.current}</span>
                        </div>
                    `;
                });

                if (trends.length > 0 && trends[0].dates.length > 0) {
                    html += `<div class="ldsp-date-labels">`;
                    trends[0].dates.forEach(d => {
                        html += `<span class="ldsp-date-label">${d}</span>`;
                    });
                    html += `</div>`;
                }

                html += `</div>`;
            }

            return html;
        }

        renderMonthTrend(history, reqs, historyManager, readingTracker) {
            const now = Date.now();
            const monthAgo = now - 30 * 24 * 3600000;
            const recent = history.filter(h => h.ts > monthAgo);

            if (recent.length < 2) {
                return `<div class="ldsp-empty"><div class="ldsp-empty-icon">📊</div><div class="ldsp-empty-text">本月数据不足<br>请继续访问积累数据</div></div>`;
            }

            let html = this.renderReadingMonthChart(readingTracker);

            // 使用每周增量
            const weeklyAggregates = historyManager.aggregateWeeklyIncrements(recent, reqs);
            const trendFields = this.getTrendFields(reqs);
            const trends = [];

            trendFields.forEach(field => {
                const trendData = this.calculateWeeklyTrend(weeklyAggregates, field.name);
                if (trendData.values.length > 0) {
                    trends.push({ label: field.label, ...trendData, current: field.req.currentValue });
                }
            });

            if (trends.length > 0) {
                html += `<div class="ldsp-chart"><div class="ldsp-chart-title">📈 本月每周增量<span class="ldsp-chart-subtitle">每周累积量</span></div>`;

                trends.forEach(t => {
                    const max = Math.max(...t.values, 1);
                    const bars = t.values.map((v, i) => {
                        const height = Math.max(v / max * 20, 2);
                        const isCurrentWeek = i === t.values.length - 1;
                        const opacity = isCurrentWeek ? '1' : '0.6';
                        return `<div class="ldsp-spark-bar" style="height:${height}px; opacity:${opacity}" data-value="${v}"></div>`;
                    }).join('');
                    html += `
                        <div class="ldsp-spark-row">
                            <span class="ldsp-spark-label">${t.label}</span>
                            <div class="ldsp-spark-bars">${bars}</div>
                            <span class="ldsp-spark-val">${t.current}</span>
                        </div>
                    `;
                });

                if (trends.length > 0 && trends[0].labels.length > 0) {
                    html += `<div class="ldsp-date-labels" style="padding-left: 60px;">`;
                    trends[0].labels.forEach(label => {
                        html += `<span class="ldsp-date-label">${label}</span>`;
                    });
                    html += `</div>`;
                }

                html += `</div>`;
            }

            return html;
        }

        renderYearTrend(history, reqs, historyManager, readingTracker) {
            const now = Date.now();
            const yearAgo = now - 365 * 24 * 3600000;
            const recent = history.filter(h => h.ts > yearAgo);

            if (recent.length < 2) {
                return `<div class="ldsp-empty"><div class="ldsp-empty-icon">📈</div><div class="ldsp-empty-text">本年数据不足<br>请持续使用积累数据</div></div>`;
            }

            let html = this.renderReadingYearChart(readingTracker);
            const monthlyAggregates = historyManager.aggregateMonthlyIncrements(recent, reqs);
            const trendFields = this.getTrendFields(reqs);
            const trends = [];

            trendFields.forEach(field => {
                const trendData = this.calculateMonthlyTrend(monthlyAggregates, field.name);
                if (trendData.values.some(v => v > 0)) {
                    trends.push({ label: field.label, ...trendData, current: field.req.currentValue });
                }
            });

            if (trends.length > 0) {
                html += `<div class="ldsp-chart"><div class="ldsp-chart-title">📊 本年每月增量<span class="ldsp-chart-subtitle">每月累积量</span></div>`;

                trends.forEach(t => {
                    const max = Math.max(...t.values, 1);
                    const bars = t.values.map((v, i) => {
                        const height = Math.max(v / max * 16, 2);
                        return `<div class="ldsp-spark-bar" style="height:${height}px" data-value="${v}" title="${(i + 1)}月: ${v}"></div>`;
                    }).join('');
                    html += `
                        <div class="ldsp-spark-row">
                            <span class="ldsp-spark-label">${t.label}</span>
                            <div class="ldsp-spark-bars" style="max-width: 100%;">${bars}</div>
                            <span class="ldsp-spark-val">${t.current}</span>
                        </div>
                    `;
                });

                html += `</div>`;
            }

            return html;
        }

        renderAllTrend(history, reqs, readingTracker) {
            if (history.length < 2) {
                return `<div class="ldsp-empty"><div class="ldsp-empty-icon">🌐</div><div class="ldsp-empty-text">全部历史数据<br>持续访问积累数据</div></div>`;
            }

            const oldest = history[0];
            const newest = history[history.length - 1];
            const totalDays = Math.ceil((Date.now() - oldest.ts) / 86400000);

            let html = `<div class="ldsp-time-info">共记录 <span>${totalDays}</span> 天数据</div>`;

            const totalReadingTime = readingTracker.getTotalReadingTime();
            const avgReadingTime = Math.round(totalReadingTime / Math.max(totalDays, 1));

            if (totalReadingTime > 0) {
                const level = Utils.getReadingLevel(avgReadingTime);
                html += `
                    <div class="ldsp-reading-stats">
                        <div class="ldsp-reading-stats-icon">📚</div>
                        <div class="ldsp-reading-stats-info">
                            <div class="ldsp-reading-stats-value">${Utils.formatReadingTime(totalReadingTime)}</div>
                            <div class="ldsp-reading-stats-label">累计阅读时间 · 日均 ${Utils.formatReadingTime(avgReadingTime)}</div>
                        </div>
                        <div class="ldsp-reading-stats-badge" style="background: ${level.bg}; color: ${level.color};">${level.label}</div>
                    </div>
                `;
            }

            let changes = '';
            reqs.forEach(r => {
                const oldVal = oldest.data[r.name] || 0;
                const newVal = newest.data[r.name] || 0;
                const diff = newVal - oldVal;
                if (diff !== 0) {
                    const name = Utils.simplifyName(r.name);
                    const cls = diff > 0 ? 'up' : 'down';
                    changes += `
                        <div class="ldsp-change-row">
                            <span class="ldsp-change-name">${name}</span>
                            <span class="ldsp-change-val ${cls}">${diff > 0 ? '+' : ''}${diff}</span>
                        </div>
                    `;
                }
            });

            if (changes) {
                html += `<div class="ldsp-chart"><div class="ldsp-chart-title">📊 累计变化</div><div class="ldsp-changes">${changes}</div></div>`;
            }

            return html;
        }

        renderReadingWeekChart(readingTracker) {
            const days = readingTracker.getReadingTimeHistory(7);
            const maxTime = Math.max(...days.map(d => d.minutes), 60);

            let barsHtml = days.map((d) => {
                const height = Math.max(d.minutes / maxTime * 45, 3);
                const timeStr = Utils.formatReadingTime(d.minutes);
                const opacity = d.isToday ? '1' : '0.7';
                const dayIndex = new Date(d.date).getDay();
                const weekDayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                const dayLabel = weekDayLabels[dayIndex];
                return `
                    <div class="ldsp-reading-day">
                        <div class="ldsp-reading-day-bar" style="height:${height}px; opacity:${opacity}" data-time="${timeStr}"></div>
                        <span class="ldsp-reading-day-label">${dayLabel}</span>
                    </div>
                `;
            }).join('');

            const totalWeekTime = days.reduce((sum, d) => sum + d.minutes, 0);
            const avgTime = Math.round(totalWeekTime / 7);

            return `
                <div class="ldsp-chart">
                    <div class="ldsp-chart-title">
                        ⏱️ 7天阅读时间
                        <span class="ldsp-chart-subtitle">共 ${Utils.formatReadingTime(totalWeekTime)} · 日均 ${Utils.formatReadingTime(avgTime)}</span>
                    </div>
                    <div class="ldsp-reading-week">
                        ${barsHtml}
                    </div>
                </div>
            `;
        }

        renderReadingMonthChart(readingTracker) {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth();
            const currentDay = today.getDate();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const days = [];
            let maxTime = 1;

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateKey = date.toDateString();
                const isToday = day === currentDay;
                const isFuture = day > currentDay;
                const minutes = isFuture
                    ? 0
                    : (isToday ? readingTracker.getTodayReadingTime() : readingTracker.getReadingTimeForDate(dateKey));

                if (!isFuture) {
                    maxTime = Math.max(maxTime, minutes);
                }

                days.push({ date: dateKey, day, minutes: Math.max(minutes, 0), isToday, isFuture });
            }

            const totalMonthTime = days.filter(d => !d.isFuture).reduce((sum, d) => sum + d.minutes, 0);
            const avgTime = currentDay > 0 ? Math.round(totalMonthTime / currentDay) : 0;

            const barsHtml = days.map((d) => {
                const height = maxTime > 0 ? (d.minutes > 0 ? Math.max(d.minutes / maxTime * 45, 2) : 1) : 1;
                const timeStr = d.isFuture ? '0分钟 (未到)' : Utils.formatReadingTime(d.minutes);
                const opacity = d.isFuture ? '0.35' : (d.isToday ? '1' : '0.75');
                return `
                    <div class="ldsp-reading-day" style="margin: 0 1px; flex: 1; min-width: 2px;">
                        <div class="ldsp-reading-day-bar" style="height:${height}px; opacity:${opacity}; background:var(--accent-secondary); width:100%; border-radius:3px 3px 0 0;" data-time="${d.day}日: ${timeStr}"></div>
                        <div class="ldsp-reading-day-label" style="margin-top:3px;">${d.day}</div>
                    </div>
                `;
            }).join('');

            return `
                <div class="ldsp-chart">
                    <div class="ldsp-chart-title">
                        ⏱️ 本月阅读时间
                        <span class="ldsp-chart-subtitle">共 ${Utils.formatReadingTime(totalMonthTime)} · 日均 ${Utils.formatReadingTime(avgTime)}</span>
                    </div>
                    <div class="ldsp-reading-week" style="height:100px; align-items: flex-end; gap:1px;">
                        ${barsHtml}
                    </div>
                </div>
            `;
        }

        renderReadingYearChart(readingTracker) {
            const today = new Date();
            const currentYear = today.getFullYear();

            const yearData = readingTracker.getYearData();

            const jan1 = new Date(currentYear, 0, 1);
            const jan1Weekday = jan1.getDay();
            const leadingBlanks = jan1Weekday === 0 ? 6 : (jan1Weekday - 1);

            let totalYearTime = 0;
            yearData.forEach(minutes => {
                totalYearTime += minutes;
            });

            const days = [];

            for (let i = 0; i < leadingBlanks; i++) {
                days.push({ isPlaceholder: true });
            }

            let currentDate = new Date(jan1);
            while (currentDate <= today) {
                const dateKey = currentDate.toDateString();
                const minutes = yearData.get(dateKey) || 0;

                days.push({
                    date: new Date(currentDate),
                    minutes: Math.max(minutes, 0),
                    month: currentDate.getMonth(),
                    day: currentDate.getDate(),
                    year: currentDate.getFullYear(),
                    isCurrentYear: true,
                    isPlaceholder: false
                });

                currentDate.setDate(currentDate.getDate() + 1);
            }

            const DAYS_PER_ROW = 14;
            const remainder = days.length % DAYS_PER_ROW;
            if (remainder !== 0) {
                const pad = DAYS_PER_ROW - remainder;
                for (let i = 0; i < pad; i++) {
                    days.push({ isPlaceholder: true });
                }
            }

            const rows = [];
            for (let i = 0; i < days.length; i += DAYS_PER_ROW) {
                rows.push(days.slice(i, i + DAYS_PER_ROW));
            }

            const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

            // 修复：计算每个月份占据的行范围，并在中间行显示标签
            const monthRowInfo = new Map(); // month -> { startRow, endRow }

            rows.forEach((rowDays, rowIndex) => {
                rowDays.forEach(d => {
                    if (!d.isPlaceholder && d.isCurrentYear) {
                        const month = d.month;
                        if (!monthRowInfo.has(month)) {
                            monthRowInfo.set(month, { startRow: rowIndex, endRow: rowIndex });
                        } else {
                            const info = monthRowInfo.get(month);
                            info.endRow = rowIndex;
                        }
                    }
                });
            });

            // 计算每个月份标签应该显示在哪一行（该月的中间行）
            const monthLabelRows = new Map(); // rowIndex -> monthName
            monthRowInfo.forEach((info, month) => {
                const middleRow = Math.floor((info.startRow + info.endRow) / 2);
                // 如果该行已经有标签，尝试放到相邻行
                if (!monthLabelRows.has(middleRow)) {
                    monthLabelRows.set(middleRow, monthNames[month]);
                } else {
                    // 尝试放到下一行或上一行
                    if (!monthLabelRows.has(middleRow + 1) && middleRow + 1 <= info.endRow) {
                        monthLabelRows.set(middleRow + 1, monthNames[month]);
                    } else if (!monthLabelRows.has(middleRow - 1) && middleRow - 1 >= info.startRow) {
                        monthLabelRows.set(middleRow - 1, monthNames[month]);
                    }
                }
            });

            let html = `
                <div class="ldsp-chart">
                    <div class="ldsp-chart-title">
                        ⏱️ 本年阅读时间
                        <span class="ldsp-chart-subtitle">共 ${Utils.formatReadingTime(totalYearTime)}</span>
                    </div>
                    <div class="ldsp-year-heatmap-container">
                        <div class="ldsp-year-heatmap-wrapper">
            `;

            rows.forEach((rowDays, rowIndex) => {
                const monthLabel = monthLabelRows.get(rowIndex) || '';

                html += `
                    <div class="ldsp-year-heatmap-month-row">
                        <span class="ldsp-year-month-label">${monthLabel}</span>
                        <div class="ldsp-year-heatmap-cells">
                `;

                rowDays.forEach(d => {
                    if (d.isPlaceholder) {
                        html += `<div class="ldsp-year-heatmap-cell empty"></div>`;
                        return;
                    }

                    const level = Utils.getHeatmapLevel(d.minutes);
                    const dateStr = `${d.month + 1}/${d.day}`;
                    const timeStr = Utils.formatReadingTime(d.minutes);

                    html += `
                        <div class="ldsp-year-heatmap-cell level-${level}">
                            <div class="ldsp-year-heatmap-tooltip">${dateStr}<br>${timeStr}</div>
                        </div>
                    `;
                });

                html += `</div></div>`;
            });

            html += `
                        </div>
                        <div class="ldsp-heatmap-legend" style="margin-top:6px;">
                            <span style="font-size:7px;">&lt;1分</span>
                            <div class="ldsp-heatmap-legend-cell" style="background: rgba(124, 58, 237, 0.08);"></div>
                            <div class="ldsp-heatmap-legend-cell" style="background: rgba(124, 58, 237, 0.25);"></div>
                            <div class="ldsp-heatmap-legend-cell" style="background: rgba(124, 58, 237, 0.45);"></div>
                            <div class="ldsp-heatmap-legend-cell" style="background: rgba(124, 58, 237, 0.65);"></div>
                            <div class="ldsp-heatmap-legend-cell" style="background: var(--accent-primary);"></div>
                            <span style="font-size:7px;">&gt;3小时</span>
                        </div>
                    </div>
                </div>
            `;

            return html;
        }

        calculateDailyTrend(dailyAggregates, name, maxDays) {
            const values = [];
            const dates = [];

            const sortedDays = Array.from(dailyAggregates.keys()).sort((a, b) =>
                new Date(a).getTime() - new Date(b).getTime()
            ).slice(-maxDays);

            sortedDays.forEach(day => {
                const d = new Date(day);
                dates.push(Utils.formatDate(d.getTime(), 'short'));
                const increment = dailyAggregates.get(day)[name] || 0;
                values.push(Math.max(increment, 0));
            });

            return { values, dates };
        }

        calculateWeeklyTrend(weeklyAggregates, name) {
            const values = [];
            const labels = [];

            const sortedWeeks = Array.from(weeklyAggregates.keys()).sort((a, b) => a - b);

            sortedWeeks.forEach(weekIdx => {
                const weekData = weeklyAggregates.get(weekIdx);
                labels.push(weekData.label);
                const increment = weekData.data[name] || 0;
                values.push(Math.max(increment, 0));
            });

            return { values, labels };
        }

        calculateMonthlyTrend(monthlyAggregates, name) {
            const values = [];
            const dates = [];

            const sortedMonths = Array.from(monthlyAggregates.keys()).sort((a, b) =>
                new Date(a).getTime() - new Date(b).getTime()
            );

            sortedMonths.forEach((month) => {
                const date = new Date(month);
                dates.push((date.getMonth() + 1) + '月');
                const increment = monthlyAggregates.get(month)[name] || 0;
                values.push(Math.max(increment, 0));
            });

            return { values, dates };
        }

        showToast(message) {
            const toast = document.createElement('div');
            toast.className = 'ldsp-toast';
            toast.innerHTML = message;
            this.panel.el.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 4000);
        }
    }

    // ==================== 主面板类 ====================
    class Panel {
        constructor() {
            this.storage = new StorageManager();
            this.network = new NetworkManager();
            this.state = new StateManager();
            this.historyManager = new HistoryManager(this.storage);
            this.readingTracker = new ReadingTimeTracker(this.storage);
            this.notifier = new NotificationManager(this.storage);

            this.prevReqs = [];
            let trendTab = this.storage.getGlobal('trendTab', 'today');
            if (trendTab === 'last' || trendTab === '7d') {
                trendTab = 'today';
                this.storage.setGlobal('trendTab', trendTab);
            }
            this.currentTrendTab = trendTab;
            this.userAvatar = this.storage.get('userAvatar', null);
            this.currentReadingTime = 0;
            this.currentUsername = null;
            this.readingUpdateInterval = null;
            this.panelConfig = getPanelConfig();
            this.shouldAnimateRing = true;

            this.cachedHistory = [];
            this.cachedReqs = [];

            this.isDragging = false;

            // 修复：添加加载状态标志，防止连点
            this.isLoading = false;

            this.injectStyles();
            this.createPanel();
            this.renderer = new PanelRenderer(this);
            this.bindEvents();
            this.restore();
            this.fetchAvatar();
            this.fetch();

            window.addEventListener('resize', Utils.debounce(() => this.handleResize(), 250));

            setInterval(() => this.fetch(), CONFIG.REFRESH_INTERVAL);
        }

        handleResize() {
            this.panelConfig = getPanelConfig();
            this.el.style.setProperty('--panel-width', `${this.panelConfig.width}px`);
            this.el.style.setProperty('--panel-max-height', `${this.panelConfig.maxHeight}px`);
            this.el.style.setProperty('--panel-font-size', `${this.panelConfig.fontSize}px`);
            this.el.style.setProperty('--panel-padding', `${this.panelConfig.padding}px`);
            this.el.style.setProperty('--avatar-size', `${this.panelConfig.avatarSize}px`);
            this.el.style.setProperty('--ring-size', `${this.panelConfig.ringSize}px`);
            this.updateExpandDirection();
        }

        updateExpandDirection() {
            const rect = this.el.getBoundingClientRect();
            const panelCenter = rect.left + rect.width / 2;
            const windowCenter = window.innerWidth / 2;

            this.el.classList.remove('expand-left', 'expand-right');

            if (panelCenter > windowCenter) {
                this.el.classList.add('expand-left');
            } else {
                this.el.classList.add('expand-right');
            }
        }

        injectStyles() {
            const style = document.createElement('style');
            style.id = 'ldsp-styles';
            style.textContent = StyleGenerator.generate();
            document.head.appendChild(style);
        }

        createPanel() {
            this.el = document.createElement('div');
            this.el.id = 'ldsp-panel';
            this.el.setAttribute('role', 'complementary');
            this.el.setAttribute('aria-label', `${CURRENT_SITE.name} 信任级别面板`);

            this.el.innerHTML = `
                <div class="ldsp-header">
                    <div class="ldsp-header-info">
                        <img class="ldsp-site-icon" src="${CURRENT_SITE.icon}" alt="${CURRENT_SITE.name}" />
                        <span class="ldsp-title">${CURRENT_SITE.name}</span>
                        <span class="ldsp-version">v${GM_info.script.version}</span>
                    </div>
                    <div class="ldsp-header-btns">
                        <button class="ldsp-btn-update" title="检查更新" aria-label="检查更新">🔍</button>
                        <button class="ldsp-btn-refresh" title="刷新数据" aria-label="刷新数据">🔄</button>
                        <button class="ldsp-btn-theme" title="切换主题" aria-label="切换主题">🌓</button>
                        <button class="ldsp-btn-toggle" title="折叠" aria-label="折叠面板" aria-expanded="true">◀</button>
                    </div>
                </div>
                <div class="ldsp-body">
                    <div class="ldsp-user">
                        <div class="ldsp-avatar-placeholder">👤</div>
                        <div class="ldsp-user-info">
                            <div class="ldsp-user-name">加载中...</div>
                            <div class="ldsp-user-meta">
                                <span class="ldsp-user-level">Lv ?</span>
                                <span class="ldsp-user-status">--</span>
                            </div>
                        </div>
                        <div class="ldsp-reading-card">
                            <span class="ldsp-reading-icon">🌱</span>
                            <span class="ldsp-reading-time">--</span>
                            <span class="ldsp-reading-label">今日阅读</span>
                        </div>
                    </div>

                    <div class="ldsp-status" role="status">
                        <span>⏳</span><span>获取数据中...</span>
                    </div>

                    <div class="ldsp-tabs" role="tablist">
                        <button class="ldsp-tab active" data-tab="reqs" role="tab" aria-selected="true" tabindex="0">📋 要求</button>
                        <button class="ldsp-tab" data-tab="trends" role="tab" aria-selected="false" tabindex="-1">📈 趋势</button>
                    </div>

                    <div class="ldsp-content">
                        <div id="ldsp-reqs" class="ldsp-panel-section active" role="tabpanel">
                            <div class="ldsp-loading">
                                <div class="ldsp-spinner"></div>
                                <div>加载中...</div>
                            </div>
                        </div>
                        <div id="ldsp-trends" class="ldsp-panel-section" role="tabpanel">
                            <div class="ldsp-empty">
                                <div class="ldsp-empty-icon">📊</div>
                                <div class="ldsp-empty-text">暂无历史数据</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(this.el);

            this.$ = {
                header: this.el.querySelector('.ldsp-header'),
                user: this.el.querySelector('.ldsp-user'),
                userName: this.el.querySelector('.ldsp-user-name'),
                userLevel: this.el.querySelector('.ldsp-user-level'),
                userStatus: this.el.querySelector('.ldsp-user-status'),
                readingCard: this.el.querySelector('.ldsp-reading-card'),
                readingIcon: this.el.querySelector('.ldsp-reading-icon'),
                readingTime: this.el.querySelector('.ldsp-reading-time'),
                readingLabel: this.el.querySelector('.ldsp-reading-label'),
                status: this.el.querySelector('.ldsp-status'),
                tabs: this.el.querySelectorAll('.ldsp-tab'),
                sections: this.el.querySelectorAll('.ldsp-panel-section'),
                reqs: this.el.querySelector('#ldsp-reqs'),
                trends: this.el.querySelector('#ldsp-trends'),
                btnToggle: this.el.querySelector('.ldsp-btn-toggle'),
                btnRefresh: this.el.querySelector('.ldsp-btn-refresh'),
                btnTheme: this.el.querySelector('.ldsp-btn-theme'),
                btnUpdate: this.el.querySelector('.ldsp-btn-update')
            };
        }

        bindEvents() {
            let dragging = false, ox, oy;
            let hasMoved = false;

            const startDrag = (e) => {
                if (!this.el.classList.contains('collapsed') && e.target.closest('button')) return;

                dragging = true;
                hasMoved = false;
                ox = e.clientX - this.el.offsetLeft;
                oy = e.clientY - this.el.offsetTop;
                this.el.classList.add('no-transition');
                e.preventDefault();
            };

            const updateDrag = (e) => {
                if (!dragging) return;
                hasMoved = true;
                // 修复：允许面板贴边，最小值为0而不是10
                let x = Math.max(0, Math.min(e.clientX - ox, innerWidth - this.el.offsetWidth));
                let y = Math.max(0, Math.min(e.clientY - oy, innerHeight - this.el.offsetHeight));
                this.el.style.left = x + 'px';
                this.el.style.top = y + 'px';
            };

            const endDrag = () => {
                if (!dragging) return;
                dragging = false;
                this.el.classList.remove('no-transition');
                this.storage.setGlobalImmediate('position', { left: this.el.style.left, top: this.el.style.top });
                this.updateExpandDirection();
            };

            this.$.header.addEventListener('mousedown', (e) => {
                if (!this.el.classList.contains('collapsed')) {
                    startDrag(e);
                }
            });

            this.el.addEventListener('mousedown', (e) => {
                if (this.el.classList.contains('collapsed')) {
                    startDrag(e);
                }
            });

            document.addEventListener('mousemove', updateDrag);
            document.addEventListener('mouseup', endDrag);

            this.$.btnToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (hasMoved) {
                    hasMoved = false;
                    return;
                }
                this.toggle();
            });

            // 修复：手动刷新时设置动画标志，并防止连点
            this.$.btnRefresh.addEventListener('click', () => {
                if (this.isLoading) return; // 如果正在加载，忽略点击
                this.shouldAnimateRing = true;
                this.fetch();
            });
            this.$.btnTheme.addEventListener('click', () => this.switchTheme());
            this.$.btnUpdate.addEventListener('click', () => this.checkUpdate());

            this.$.tabs.forEach((tab, index) => {
                tab.addEventListener('click', () => {
                    this.$.tabs.forEach((t) => {
                        t.classList.remove('active');
                        t.setAttribute('aria-selected', 'false');
                        t.setAttribute('tabindex', '-1');
                    });
                    this.$.sections.forEach(s => s.classList.remove('active'));
                    tab.classList.add('active');
                    tab.setAttribute('aria-selected', 'true');
                    tab.setAttribute('tabindex', '0');
                    this.el.querySelector(`#ldsp-${tab.dataset.tab}`).classList.add('active');

                    if (tab.dataset.tab === 'reqs') {
                        this.shouldAnimateRing = true;
                        if (this.cachedReqs.length > 0) {
                            this.renderer.renderReqs(this.cachedReqs);
                        }
                    }
                });

                tab.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        const newIndex = e.key === 'ArrowRight'
                            ? (index + 1) % this.$.tabs.length
                            : (index - 1 + this.$.tabs.length) % this.$.tabs.length;
                        this.$.tabs[newIndex].click();
                        this.$.tabs[newIndex].focus();
                    }
                });
            });
        }

        restore() {
            const pos = this.storage.getGlobal('position');
            if (pos) {
                this.el.style.left = pos.left;
                this.el.style.top = pos.top;
            }

            const isCollapsed = this.storage.getGlobal('collapsed', false);
            if (isCollapsed) {
                this.el.classList.add('collapsed');
                this.$.btnToggle.textContent = '▶';
                this.$.btnToggle.setAttribute('aria-expanded', 'false');
                this.$.btnToggle.setAttribute('aria-label', '展开面板');
            }

            const theme = this.storage.getGlobal('theme', 'dark');
            if (theme === 'light') this.el.classList.add('light');
            this.$.btnTheme.textContent = theme === 'dark' ? '🌓' : '☀️';

            requestAnimationFrame(() => {
                this.updateExpandDirection();
            });
        }

        toggle() {
            const isCollapsing = !this.el.classList.contains('collapsed');
            const rect = this.el.getBoundingClientRect();

            this.el.classList.add('animating');

            if (isCollapsing) {
                if (this.el.classList.contains('expand-left')) {
                    const newLeft = rect.right - 44;
                    this.el.style.left = newLeft + 'px';
                }

                this.$.btnToggle.textContent = '▶';
                this.$.btnToggle.setAttribute('aria-expanded', 'false');
                this.$.btnToggle.setAttribute('aria-label', '展开面板');
            } else {
                this.updateExpandDirection();

                if (this.el.classList.contains('expand-left')) {
                    const newLeft = rect.left - (this.panelConfig.width - 44);
                    // 修复：展开时允许贴边，最小值为0
                    this.el.style.left = Math.max(0, newLeft) + 'px';
                }

                this.$.btnToggle.textContent = '◀';
                this.$.btnToggle.setAttribute('aria-expanded', 'true');
                this.$.btnToggle.setAttribute('aria-label', '折叠面板');

                this.shouldAnimateRing = true;
                if (this.cachedReqs.length > 0) {
                    setTimeout(() => {
                        this.renderer.renderReqs(this.cachedReqs);
                    }, 100);
                }
            }

            this.el.classList.toggle('collapsed');
            this.storage.setGlobalImmediate('collapsed', isCollapsing);

            setTimeout(() => {
                this.el.classList.remove('animating');
                this.storage.setGlobalImmediate('position', { left: this.el.style.left, top: this.el.style.top });
            }, 400);
        }

        switchTheme() {
            const isLight = this.el.classList.toggle('light');
            this.$.btnTheme.textContent = isLight ? '☀️' : '🌓';
            this.storage.setGlobalImmediate('theme', isLight ? 'light' : 'dark');
        }

        fetchAvatar() {
            const avatarEl = document.querySelector('.current-user img.avatar');
            if (avatarEl) {
                this.updateAvatar(avatarEl.src);
                return;
            }
            if (this.userAvatar) {
                this.renderer.renderAvatar(this.userAvatar);
            }
        }

        updateAvatar(url) {
            if (url) {
                if (url.startsWith('/')) {
                    url = `https://${CURRENT_SITE.domain}${url}`;
                }
                url = url.replace(/\/\d+\//, '/128/');
                this.userAvatar = url;
                this.storage.set('userAvatar', url);
                this.renderer.renderAvatar(url);
            }
        }

        startReadingTimeUpdate() {
            if (this.readingUpdateInterval) return;

            this.readingUpdateInterval = setInterval(() => {
                this.currentReadingTime = this.readingTracker.getTodayReadingTime();
                this.renderer.renderReadingCard(this.currentReadingTime);
            }, 1000);
        }

        // 修复：添加加载状态控制
        setLoadingState(loading) {
            this.isLoading = loading;
            if (this.$.btnRefresh) {
                this.$.btnRefresh.disabled = loading;
                if (loading) {
                    this.$.btnRefresh.style.animation = 'ldsp-spin 1s linear infinite';
                } else {
                    this.$.btnRefresh.style.animation = '';
                }
            }
        }

        async fetch() {
            // 修复：如果已经在加载中，直接返回
            if (this.isLoading) return;

            this.setLoadingState(true);
            this.$.reqs.innerHTML = `<div class="ldsp-loading"><div class="ldsp-spinner"></div><div>加载中...</div></div>`;

            try {
                const html = await this.network.fetch(CURRENT_SITE.apiUrl);
                this.parse(html);
            } catch (error) {
                this.showError(error.message || '网络错误');
            } finally {
                this.setLoadingState(false);
            }
        }

        showError(msg) {
            this.$.reqs.innerHTML = `<div class="ldsp-empty"><div class="ldsp-empty-icon">❌</div><div class="ldsp-empty-text">${msg}</div></div>`;
        }

        parse(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const section = [...doc.querySelectorAll('.bg-white.p-6.rounded-lg')]
                .find(d => d.querySelector('h2')?.textContent.includes('信任级别'));

            if (!section) return this.showError('未找到数据，请登录');

            const heading = section.querySelector('h2').textContent;
            const [, username, level] = heading.match(/(.*) - 信任级别 (\d+)/) || ['', '未知', '?'];

            if (username && username !== '未知') {
                this.storage.setCurrentUser(username);
                this.currentUsername = username;
                this.readingTracker.init(username);
                this.startReadingTimeUpdate();
            }

            const avatarEl = doc.querySelector('img[src*="avatar"]');
            if (avatarEl) {
                this.updateAvatar(avatarEl.src);
            }

            this.currentReadingTime = this.readingTracker.getTodayReadingTime();
            this.renderer.renderReadingCard(this.currentReadingTime);

            const rows = section.querySelectorAll('table tr');
            const requirements = [];

            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].querySelectorAll('td');
                if (cells.length < 3) continue;

                const name = cells[0].textContent.trim();
                const currentMatch = cells[1].textContent.match(/(\d+)/);
                const requiredMatch = cells[2].textContent.match(/(\d+)/);
                const currentValue = currentMatch ? +currentMatch[1] : 0;
                const requiredValue = requiredMatch ? +requiredMatch[1] : 0;
                const isSuccess = cells[1].classList.contains('text-green-500');

                const prev = this.prevReqs.find(p => p.name === name);
                const change = prev ? currentValue - prev.currentValue : 0;

                requirements.push({
                    name,
                    currentValue,
                    requiredValue,
                    isSuccess,
                    change,
                    isReverse: /被举报|发起举报|禁言|封禁/.test(name)
                });
            }

            const reorderedReqs = Utils.reorderRequirements(requirements);
            const isOK = !section.querySelector('p.text-red-500');

            this.notifier.check(reorderedReqs);

            const histData = {};
            reorderedReqs.forEach(r => histData[r.name] = r.currentValue);
            const history = this.historyManager.addHistory(histData, this.currentReadingTime);

            const todayData = this.getTodayData();
            if (!todayData) {
                this.setTodayData(histData, this.currentReadingTime, true);
            } else {
                this.setTodayData(histData, this.currentReadingTime, false);
            }

            this.renderer.renderUser(username, level, isOK, reorderedReqs);
            this.renderer.renderReqs(reorderedReqs);

            this.cachedHistory = history;
            this.cachedReqs = reorderedReqs;

            this.renderTrends(history, reorderedReqs, this.currentReadingTime);

            this.setLastVisitData(histData, this.currentReadingTime);
            this.prevReqs = reorderedReqs;
        }

        getTodayData() {
            const stored = this.storage.get('todayData', null);
            if (stored && stored.date === Utils.getTodayKey()) {
                return stored;
            }
            return null;
        }

        setTodayData(data, readingTime = 0, isStart = false) {
            const today = Utils.getTodayKey();
            const existing = this.getTodayData();
            if (isStart || !existing) {
                this.storage.set('todayData', {
                    date: today,
                    startData: data,
                    startTs: Date.now(),
                    startReadingTime: readingTime,
                    currentData: data,
                    currentTs: Date.now(),
                    currentReadingTime: readingTime
                });
            } else {
                this.storage.set('todayData', {
                    ...existing,
                    currentData: data,
                    currentTs: Date.now(),
                    currentReadingTime: readingTime
                });
            }
        }

        setLastVisitData(data, readingTime = 0) {
            this.storage.set('lastVisit', { ts: Date.now(), data, readingTime });
        }

        renderTrends(history, reqs, currentReadingTime) {
            this.renderer.renderTrends(history, reqs, currentReadingTime, this.currentTrendTab);

            this.$.trends.querySelectorAll('.ldsp-subtab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.currentTrendTab = tab.dataset.trend;
                    this.storage.setGlobal('trendTab', this.currentTrendTab);
                    this.$.trends.querySelectorAll('.ldsp-subtab').forEach(t => {
                        t.classList.remove('active');
                        t.setAttribute('aria-selected', 'false');
                    });
                    tab.classList.add('active');
                    tab.setAttribute('aria-selected', 'true');
                    this.renderTrendContent(history, reqs, currentReadingTime);
                });
            });

            this.renderTrendContent(history, reqs, currentReadingTime);
        }

        renderTrendContent(history, reqs, currentReadingTime) {
            const container = this.$.trends.querySelector('.ldsp-trend-content');

            if (this.currentTrendTab === 'year') {
                container.innerHTML = this.renderer.renderLoading();

                requestAnimationFrame(() => {
                    setTimeout(() => {
                        container.innerHTML = this.renderer.renderYearTrend(
                            history, reqs, this.historyManager, this.readingTracker
                        );
                    }, 50);
                });
                return;
            }

            switch (this.currentTrendTab) {
                case 'today':
                    container.innerHTML = this.renderer.renderTodayTrend(reqs, currentReadingTime, this.getTodayData());
                    break;
                case 'week':
                    container.innerHTML = this.renderer.renderWeekTrend(history, reqs, this.historyManager, this.readingTracker);
                    break;
                case 'month':
                    container.innerHTML = this.renderer.renderMonthTrend(history, reqs, this.historyManager, this.readingTracker);
                    break;
                case 'all':
                    container.innerHTML = this.renderer.renderAllTrend(history, reqs, this.readingTracker);
                    break;
            }
        }

        async checkUpdate() {
            const url = 'https://raw.githubusercontent.com/caigg188/LDStatusPro/main/LDStatusPro.user.js';
            this.$.btnUpdate.textContent = '⏳';

            try {
                const text = await this.network.fetch(url, { maxRetries: 1 });
                const match = text.match(/@version\s+([\d.]+)/);
                if (match) {
                    const remote = match[1];
                    if (Utils.compareVersion(remote, GM_info.script.version) > 0) {
                        this.$.btnUpdate.textContent = '🆕';
                        this.$.btnUpdate.title = `新版本 v${remote}`;
                        this.$.btnUpdate.onclick = () => window.open(url);
                    } else {
                        this.$.btnUpdate.textContent = '✅';
                        setTimeout(() => { this.$.btnUpdate.textContent = '🔍'; }, 2000);
                    }
                }
            } catch (e) {
                this.$.btnUpdate.textContent = '❌';
                setTimeout(() => { this.$.btnUpdate.textContent = '🔍'; }, 2000);
            }
        }

        destroy() {
            this.readingTracker.destroy();
            this.storage.flush();
            if (this.readingUpdateInterval) {
                clearInterval(this.readingUpdateInterval);
            }
            this.el.remove();
        }
    }

    // ==================== 启动 ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new Panel());
    } else {
        new Panel();
    }

})();
