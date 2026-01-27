// ==UserScript==
// @name         幕布目录_V29_智能清空版
// @namespace    http://tampermonkey.net/
// @version      29.0
// @description  新增URL监听，切换文档时自动清空旧大纲，修复内容重叠问题
// @author       Vachel
// @match        https://mubu.com/*
// @grant        none
// @updateURL    https://github.com/lwqhhh/Mubu-Smart-Outline/raw/refs/heads/main/%E5%B9%95%E5%B8%83%E7%9B%AE%E5%BD%95_V29.user.js
// @downloadURL  https://github.com/lwqhhh/Mubu-Smart-Outline/raw/refs/heads/main/%E5%B9%95%E5%B8%83%E7%9B%AE%E5%BD%95_V29.user.js
// ==/UserScript==

(function() {
    'use strict';

    let savedList = [];
    let isMoving = false;
    let isMinimized = false;
    let themeMode = 0;
    let systemIsDark = false;

    // ⚡️ 新增：记录当前 URL，用于检测页面切换
    let lastUrl = window.location.href;

    // --- 1. 配置初始化 ---
    const CONFIG_KEY_THEME = 'mubu_toc_theme_pref_v29';
    try {
        const savedTheme = localStorage.getItem(CONFIG_KEY_THEME);
        if (savedTheme) themeMode = parseInt(savedTheme);
    } catch(e) {}

    const winW = window.innerWidth || document.documentElement.clientWidth;
    const winH = window.innerHeight || document.documentElement.clientHeight;

    let config = {
        mode: 'float',
        x: winW - 300,
        y: 100,
        width: 260,
        iconX: winW - 80,
        iconY: winH - 150
    };

    const THEME = {
        light: {
            bg: '#fff', border: '#e0e0e0', headerBg: '#f5f5f5', headerText: '#333',
            text: '#333', subText: '#666', hover: '#e6f7ff', highlight: '#fff9c4',
            btn: '#999', btnHover: '#333'
        },
        dark: {
            bg: '#222', border: '#444', headerBg: '#333', headerText: '#ccc',
            text: '#ccc', subText: '#999', hover: '#444', highlight: '#555',
            btn: '#888', btnHover: '#fff'
        }
    };

    // --- 2. UI 构建 ---
    const container = createEl('div', {
        position: 'fixed', zIndex: '999999', display: 'flex', flexDirection: 'column',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)', overflow: 'hidden',
        transition: 'height 0.3s, width 0.3s, opacity 0.2s, transform 0.2s, background 0.3s, border 0.3s'
    });

    const header = createEl('div', {
        padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        cursor: 'move', userSelect: 'none', transition: 'background 0.3s, border 0.3s'
    });

    const titleSpan = createEl('span', { fontWeight: 'bold', fontSize: '13px', transition: 'color 0.3s' });
    titleSpan.innerText = '📑 目录';

    const btnGroup = createEl('div', { display: 'flex', gap: '4px' });

    const btnToTop = createBtn('⬆️', '回顶', scrollToTop);
    const btnToBottom = createBtn('⬇️', '到底', scrollToBottom);
    const btnTheme = createBtn('🌓', '切换主题', toggleTheme);
    const btnMin = createBtn('➖', '最小化', toggleMinimize);
    const btnFloat = createBtn('✥', '归位', () => { config.x = window.innerWidth - 300; config.y = 100; setMode('float'); });
    const btnClean = createBtn('🗑️', '清空', clearAll);

    btnGroup.append(btnTheme, btnToTop, btnToBottom, btnFloat, btnMin, btnClean);
    header.append(titleSpan, btnGroup);

    const listBody = createEl('div', { overflowY: 'auto', flex: '1', padding: '5px 0' });

    container.append(header, listBody);
    document.body.appendChild(container);

    // --- 最小化图标 ---
    const miniIcon = createEl('div', {
        position: 'fixed', left: config.iconX + 'px', top: config.iconY + 'px',
        width: '40px', height: '40px', borderRadius: '50%', boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        zIndex: '999999', cursor: 'move', display: 'none', justifyContent: 'center', alignItems: 'center', fontSize: '20px', userSelect: 'none',
        transition: 'transform 0.2s, background 0.3s'
    });
    miniIcon.innerText = '📑';

    let iconDragging = false, iconStartX, iconStartY;
    miniIcon.onmousedown = function(e) {
        iconDragging = false; iconStartX = e.clientX; iconStartY = e.clientY;
        const rect = miniIcon.getBoundingClientRect(); const offX = e.clientX - rect.left; const offY = e.clientY - rect.top;
        miniIcon.style.transition = 'none'; miniIcon.style.transform = 'scale(1.1)';
        document.onmousemove = function(e) {
            if (Math.abs(e.clientX - iconStartX) > 3) iconDragging = true;
            if (iconDragging) { miniIcon.style.left = (e.clientX - offX) + 'px'; miniIcon.style.top = (e.clientY - offY) + 'px'; }
        };
        document.onmouseup = function() {
            document.onmousemove = null; document.onmouseup = null;
            miniIcon.style.transition = 'transform 0.2s, background 0.3s'; miniIcon.style.transform = 'scale(1)';
            if (iconDragging) { config.iconX = parseFloat(miniIcon.style.left); config.iconY = parseFloat(miniIcon.style.top); }
            else toggleMinimize();
        };
    };
    document.body.appendChild(miniIcon);

    // --- 3. 核心：主题与状态检测 ---
    function checkTheme() {
        if (themeMode !== 0) { applyTheme(); return; }
        let bg = window.getComputedStyle(document.body).backgroundColor;
        if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = window.getComputedStyle(document.documentElement).backgroundColor;
        const rgb = bg.match(/\d+/g);
        let newSystemIsDark = false;
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            if (rgb.length === 3 || (rgb.length === 4 && parseFloat(rgb[3]) > 0.1)) newSystemIsDark = brightness < 128;
        }
        if (newSystemIsDark !== systemIsDark) { systemIsDark = newSystemIsDark; applyTheme(); }
    }

    function toggleTheme() {
        themeMode = (themeMode + 1) % 3;
        localStorage.setItem(CONFIG_KEY_THEME, themeMode);
        let label = '自动跟随';
        if (themeMode === 1) label = '☀️ 强制日间';
        if (themeMode === 2) label = '🌙 强制夜间';
        titleSpan.innerText = label; titleSpan.style.color = '#007bff';
        setTimeout(() => { titleSpan.innerText = '📑 目录'; applyTheme(); }, 1500);
        applyTheme();
    }

    function applyTheme() {
        let useDark = false;
        if (themeMode === 0) useDark = systemIsDark;
        else if (themeMode === 1) useDark = false;
        else if (themeMode === 2) useDark = true;

        const t = useDark ? THEME.dark : THEME.light;
        container.style.backgroundColor = t.bg; container.style.border = `1px solid ${t.border}`;
        header.style.backgroundColor = t.headerBg; header.style.borderBottom = `1px solid ${t.border}`;
        if (titleSpan.innerText === '📑 目录') titleSpan.style.color = t.headerText;
        [btnTheme, btnToTop, btnToBottom, btnFloat, btnMin, btnClean].forEach(b => {
            b.style.color = t.btn; b.onmouseover = () => b.style.color = t.btnHover; b.onmouseout = () => b.style.color = t.btn;
        });
        miniIcon.style.backgroundColor = t.bg; miniIcon.style.color = useDark ? '#fff' : '#000';
        renderTOC();
    }

    // --- 4. 常规功能 ---
    function toggleMinimize() {
        isMinimized = !isMinimized;
        if (isMinimized) {
            container.style.opacity = '0'; container.style.transform = 'scale(0.8)'; container.style.pointerEvents = 'none';
            setTimeout(() => { miniIcon.style.display = 'flex'; miniIcon.style.transform = 'scale(0)'; setTimeout(() => miniIcon.style.transform = 'scale(1)', 10); }, 200);
        } else {
            miniIcon.style.transform = 'scale(0)'; setTimeout(() => miniIcon.style.display = 'none', 200);
            container.style.pointerEvents = 'auto'; container.style.opacity = '1'; container.style.transform = 'scale(1)';
        }
    }

    let isDragging = false, dragStartX, dragStartY, initialLeft, initialTop;
    const SNAP_THRESHOLD = 50;
    header.onmousedown = function(e) {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY;
        if (config.mode !== 'float') { const r = container.getBoundingClientRect(); config.x = r.left; config.y = r.top; setMode('float'); }
        initialLeft = container.offsetLeft; initialTop = container.offsetTop;
        container.style.transition = 'none'; container.style.opacity = '0.9';

        document.onmousemove = function(e) {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX; const dy = e.clientY - dragStartY;
            let nx = initialLeft + dx; let ny = initialTop + dy;
            if (ny < 0) ny = 0; if (ny > window.innerHeight - 30) ny = window.innerHeight - 30;
            if (nx < 0 - config.width + 30) nx = 0 - config.width + 30; if (nx > window.innerWidth - 30) nx = window.innerWidth - 30;
            config.x = nx; config.y = ny;
            container.style.left = nx + 'px'; container.style.top = ny + 'px';
            const w = window.innerWidth;
            if (e.clientX < SNAP_THRESHOLD) showPreview('left');
            else if (e.clientX > w - SNAP_THRESHOLD) showPreview('right');
            else showPreview('none');
        };
        document.onmouseup = function(e) {
            isDragging = false; document.onmousemove = null; document.onmouseup = null;
            container.style.transition = 'height 0.3s, top 0.3s, width 0.3s, opacity 0.2s'; container.style.opacity = '1';
            const w = window.innerWidth;
            if (e.clientX < SNAP_THRESHOLD) setMode('left');
            else if (e.clientX > w - SNAP_THRESHOLD) setMode('right');
            else { setMode('float'); config.x = Math.max(0, parseFloat(container.style.left)); config.y = Math.max(0, parseFloat(container.style.top)); }
        };
    };

    function showPreview(side) {
        let useDark = (themeMode === 2) || (themeMode === 0 && systemIsDark);
        const c = '#007bff'; const t = useDark ? THEME.dark.border : THEME.light.border;
        if (side === 'left') { container.style.borderLeft = `4px solid ${c}`; container.style.borderRight = `1px solid ${t}`; }
        else if (side === 'right') { container.style.borderRight = `4px solid ${c}`; container.style.borderLeft = `1px solid ${t}`; }
        else { container.style.border = `1px solid ${t}`; }
    }

    function setMode(mode) { config.mode = mode; updateLayout(); }
    function updateLayout() {
        document.body.style.paddingLeft = ''; document.body.style.paddingRight = '';
        container.style.width = config.width + 'px';
        let useDark = (themeMode === 2) || (themeMode === 0 && systemIsDark);
        const t = useDark ? THEME.dark : THEME.light;

        if (config.mode === 'float') {
            if (config.y < 0) config.y = 100;
            Object.assign(container.style, { position: 'fixed', top: config.y + 'px', left: config.x + 'px', right: 'auto', bottom: 'auto', height: 'auto', maxHeight: '80vh', borderRadius: '8px', borderRight: `1px solid ${t.border}`, borderLeft: `1px solid ${t.border}` });
        } else {
            Object.assign(container.style, { top: '0', bottom: '0', height: '100vh', maxHeight: 'none', borderRadius: '0' });
            if (config.mode === 'left') { container.style.left = '0'; container.style.right = 'auto'; container.style.borderRight = '1px solid #ccc'; container.style.borderLeft = 'none'; document.body.style.paddingLeft = config.width + 'px'; }
            else if (config.mode === 'right') { container.style.right = '0'; container.style.left = 'auto'; container.style.borderLeft = '1px solid #ccc'; container.style.borderRight = 'none'; document.body.style.paddingRight = config.width + 'px'; }
        }
    }

    async function scrollToBottom() {
        if (isMoving) { isMoving = false; titleSpan.innerText = '🛑 已停止'; setTimeout(() => applyTheme(), 1000); return; }
        isMoving = true; titleSpan.innerText = '⬇️ 加载中...'; titleSpan.style.color = '#ff9800';
        const scrollers = getScrollers(); const step = 800; let stuckCount = 0; let lastPositions = scrollers.map(el => el === window ? window.scrollY : el.scrollTop);
        while(isMoving) {
            scrollers.forEach(el => el.scrollBy ? el.scrollBy(0, step) : el.scrollTop += step);
            await wait(200); scanNodes();
            let curPositions = scrollers.map(el => el === window ? window.scrollY : el.scrollTop);
            let moved = false; for(let i=0; i<scrollers.length; i++) if(Math.abs(curPositions[i]-lastPositions[i])>5) moved=true;
            if(!moved) { stuckCount++; titleSpan.innerText = `⏳ (${stuckCount}/8)`; if(stuckCount>=8) break; } else { stuckCount=0; titleSpan.innerText = `⬇️ ${savedList.length}`; }
            lastPositions = curPositions;
        }
        if (isMoving) { titleSpan.innerText = '✅ 到底'; titleSpan.style.color = '#28a745'; }
        isMoving = false; setTimeout(() => applyTheme(), 2000);
    }

    function scrollToTop() { if(isMoving) return; getScrollers().forEach(el => el.scrollTo ? el.scrollTo(0,0) : el.scrollTop=0); }

    async function tankGo(targetId) {
        if (isMoving) return;
        let targetNode = document.querySelector(`[data-id="${targetId}"]`);
        if (targetNode) { highlight(targetNode); return; }
        isMoving = true; const targetIdx = savedList.findIndex(x => x.id === targetId);
        let currentIdx = -1; const visibleNodes = document.querySelectorAll('.outliner-node');
        for (const node of visibleNodes) { const idx = savedList.findIndex(x => x.id === node.getAttribute('data-id')); if (idx !== -1) { currentIdx = idx; break; } }
        const direction = (currentIdx !== -1 && targetIdx < currentIdx) ? -1 : 1;
        titleSpan.innerText = direction > 0 ? '⬇️ 寻找...' : '⬆️ 寻找...'; titleSpan.style.color = '#ff9800';
        const scrollers = getScrollers(); let found = false;
        for (let i = 0; i < 300; i++) {
            scrollers.forEach(el => el.scrollBy ? el.scrollBy(0, 1000 * direction) : el.scrollTop += 1000 * direction);
            await wait(120); targetNode = document.querySelector(`[data-id="${targetId}"]`); if (targetNode) { found = true; break; }
        }
        if (found) { titleSpan.innerText = '✅ 定位'; highlight(targetNode); } else { titleSpan.innerText = '⚠️ 未找到'; }
        setTimeout(() => { isMoving = false; applyTheme(); }, 2000);
    }

    function scanNodes() {
        if (isMoving && titleSpan.innerText.includes('寻找')) return;
        checkTheme();

        // ⚡️ 核心修复：URL 变动检测 ⚡️
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            savedList = []; // 清空旧数据
            renderTOC();    // 立即清空视图
            // 可选：如果希望换页面自动回顶，可以在这里加 scrollToTop()
        }

        const visibleNodes = document.querySelectorAll('.heading1, .heading2, .heading3'); if (visibleNodes.length === 0) return;
        const currentViewItems = [];
        visibleNodes.forEach(node => {
            const parent = node.closest('.outliner-node'); const content = node.querySelector('.content');
            if (parent && content) { currentViewItems.push({ id: parent.getAttribute('data-id'), text: content.innerText.trim(), level: node.classList.contains('heading2') ? 2 : (node.classList.contains('heading3') ? 3 : 1) }); }
        });
        if (savedList.length === 0) { savedList = currentViewItems; renderTOC(); return; }
        let hasChanges = false; let anchorSavedIdx = -1, anchorViewIdx = -1;
        for (let i = 0; i < currentViewItems.length; i++) { const idx = savedList.findIndex(x => x.id === currentViewItems[i].id); if (idx !== -1) { anchorSavedIdx = idx; anchorViewIdx = i; break; } }
        if (anchorSavedIdx !== -1) {
            for (let i = anchorViewIdx - 1; i >= 0; i--) { if (!savedList.find(x => x.id === currentViewItems[i].id)) { savedList.splice(anchorSavedIdx, 0, currentViewItems[i]); hasChanges = true; } }
            let insertBase = anchorSavedIdx;
            for (let i = anchorViewIdx + 1; i < currentViewItems.length; i++) { const existingIdx = savedList.findIndex(x => x.id === currentViewItems[i].id); if (existingIdx !== -1) insertBase = existingIdx; else { savedList.splice(insertBase + 1, 0, currentViewItems[i]); insertBase++; hasChanges = true; } }
        } else { currentViewItems.forEach(item => { if (!savedList.find(x => x.id === item.id)) { savedList.push(item); hasChanges = true; } }); }
        if (hasChanges) renderTOC();
    }

    function getScrollers() {
        const set = new Set([window, document.documentElement, document.body]);
        ['.ul-container', '.mubu-editor', '.main-container', '.app-body'].forEach(s => { const e = document.querySelector(s); if(e) set.add(e); });
        document.querySelectorAll('div').forEach(d => { if (d.scrollHeight > d.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(d).overflowY)) set.add(d); });
        return Array.from(set);
    }
    function renderTOC() {
        listBody.innerHTML = '';
        let useDark = false;
        if (themeMode === 0) useDark = systemIsDark;
        else if (themeMode === 1) useDark = false;
        else if (themeMode === 2) useDark = true;
        const t = useDark ? THEME.dark : THEME.light;
        savedList.forEach(val => {
            const item = createEl('div', { padding: '8px 10px', paddingLeft: `${(val.level - 1) * 15 + 10}px`, cursor: 'pointer', borderBottom: `1px solid ${useDark?'#2a2a2a':'#fcfcfc'}`, color: val.level === 1 ? t.text : t.subText, fontWeight: val.level === 1 ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px' });
            item.innerText = val.text; item.onmouseover = () => item.style.background = t.hover; item.onmouseout = () => item.style.background = 'transparent'; item.onclick = () => tankGo(val.id); listBody.appendChild(item);
        });
    }
    function highlight(el) { el.scrollIntoView({ behavior: 'auto', block: 'center' }); const c = el.querySelector('.content'); if (c) { const old = c.style.background; c.style.background = '#fff9c4'; setTimeout(() => c.style.background = old, 1500); } }
    function createEl(tag, styles) { const e = document.createElement(tag); Object.assign(e.style, styles); return e; }
    function createBtn(text, tip, onClick) {
        const b = document.createElement('button'); b.innerText = text; b.title = tip;
        Object.assign(b.style, { cursor: 'pointer', background: 'none', border: 'none', fontSize: '14px', padding: '0 4px', transition: 'color 0.3s' });
        b.onclick = (e) => { e.stopPropagation(); onClick(); }; return b;
    }
    function clearAll() { if(confirm('确认清空目录？')) { savedList = []; renderTOC(); } }
    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    checkTheme();
    updateLayout();
    setInterval(scanNodes, 1000);
})();
