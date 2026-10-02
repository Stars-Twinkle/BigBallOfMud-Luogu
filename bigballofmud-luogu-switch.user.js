// ==UserScript==
// @name         BigBallOfMud Luogu — Theme Toggle + Contrast Guard
// @namespace    bigballofmud-luogu
// @version      20261003.03
// @description  配合 bigballofmud-luogu.user.css 使用（样式仍由 Stylus 提供，本脚本只管"行为"）。两件事：① 在顶栏"私信、通知"右边放一个可点的三态配色开关（跟随系统/深色/浅色，选择被记住）；② 深色下运行"对比度守卫"，自动修掉洛谷写死的浅字浅底/深字深底。
// @author       acerkaio
// @license      CC BY-NC-SA
// @match        https://www.luogu.com.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* ★ 这个文件是装进 **Tampermonkey（油猴）** 的。
   别和项目里那些 .mjs 搞混 —— 那些是 Node 命令行工具，装不了。
   判断方法：本文件第一行就是 // ==UserScript==，油猴靠它识别。
   安装：油猴图标 → 添加新脚本 → 清空编辑区 → 粘贴本文件全部内容 → Ctrl+S               */

/*
 * 为什么要用 JS（纯 CSS 做不到的两件事）
 *   1) 顶栏按钮：CSS 不能创建元素，伪元素也收不到状态、存不了状态。
 *   2) 对比度守卫：CSS 只能"猜到哪条规则就改哪条"；JS 可以直接量**最终算出来的**颜色，
 *      凡是"字和底都亮 / 都暗"的就地修掉。
 *
 * 与样式表的分工：本脚本**不注入任何 CSS**，只做三件事：
 *   · 往 <html> 写 data-sl-theme（样式里三条 color-scheme 规则接管外观）
 *   · 切换那一帧往 <html> 加 .sl-theme-switching（样式里定义了一段"统一短过渡"）
 *   · 深色下给个别元素写内联 color（对比度守卫）
 */

(function () {
    'use strict';

    /* ====================== 可调配置 ====================== */
    var CONFIG = {
        showToggle: true,          // 是否在顶栏放配色开关
        contrastGuard: true,       // 是否启用深色下的对比度守卫
        guardSkipInlineColor: true, // 跳过"洛谷自己写了内联 color"的元素（彩底标签的前景色是它按底色算的）
        guardMinRatio: 6.0,        // 深色下用更高的门槛（原 4.5 只保证"勉强达标"，观感偏灰；
                                   // 6.0 接近 WCAG AAA，能把正文提到接近正文色 —— 用户："这些文字不应该是白的吗"）
        guardTargetRatio: 7.5,     // 修正后至少要达到的对比度（比门槛再高一点，避免反复修）
        guardMaxNodes: 4000,       // 单次扫描上限（防御性：页面异常大时别卡）
        mutationDelay: 600,        // 页面变化后重跑守卫的防抖（私信这类页面变化频繁）
        switchFallbackMs: 150,     // 读不到 CSS 变量时，切换过渡的兜底时长
        debug: false
    };

    var MODE_KEY = 'sl-theme-mode';
    var MODES = ['auto', 'dark', 'light'];
    var LABELS = { auto: '配色：跟随系统', dark: '配色：深色', light: '配色：浅色' };
    var ICONS = {
        auto: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
              '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
              '<path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/></svg>',
        dark: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
              '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4 7.2 7.2 0 1 0 20 14.6z" fill="none" ' +
              'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
        light: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
               '<circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
               '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
               '<path d="M12 2.4v2.6M12 19v2.6M2.4 12h2.6M19 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9' +
               'M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9"/></g></svg>'
    };

    var root = document.documentElement;
    var isMain = location.hostname === 'www.luogu.com.cn';

    /* ======================================================================
       一、配色模式
       ====================================================================== */
    function getMode() {
        try {
            var v = localStorage.getItem(MODE_KEY);
            if (MODES.indexOf(v) >= 0) return v;
        } catch (e) { /* 隐私模式等，读不到就当 auto */ }
        return 'auto';
    }

    function applyMode(mode) {
        if (!root) return;
        if (mode === 'auto') root.removeAttribute('data-sl-theme');
        else root.setAttribute('data-sl-theme', mode);
    }

    function saveMode(mode) {
        try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 忽略 */ }
    }

    function isDarkNow() {
        var m = root && root.getAttribute('data-sl-theme');
        if (m === 'dark') return true;
        if (m === 'light') return false;
        try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
    }

    // 切换过渡时长：优先读样式里的 --sl-switch-duration，读不到用兜底值。
    // 这样"时长"只写在样式里一处，脚本跟着走，不会两边不一致。
    function switchDurationMs() {
        try {
            var v = (getComputedStyle(root).getPropertyValue('--sl-switch-duration') || '').trim();
            var n = parseFloat(v);
            if (!isNaN(n)) return v.indexOf('ms') >= 0 ? n : n * 1000;   // 支持 140ms / .14s
        } catch (e) { /* 忽略 */ }
        return CONFIG.switchFallbackMs;
    }

    /* ======================================================================
       二、顶栏开关按钮（放在"私信、通知"的右边）
       从 bundle 里读到的顶栏右侧顺序：
         .nav-search（搜索）→ a[href=/chat]（私信）→ a[href=/notification]（通知）
         → 设置下拉 → .avatar（头像）
       所以"私信和通知的右面"= 通知链接的下一个位置。
       ====================================================================== */
    function paint(btn, mode) {
        btn.innerHTML = ICONS[mode];
        btn.title = LABELS[mode] + '（点击切换）';
        btn.setAttribute('aria-label', LABELS[mode]);
        btn.setAttribute('data-mode', mode);
    }

    function findSpot(bar, btn) {
        var links = bar.querySelectorAll('a[href]');
        var hit = null, i;
        for (i = 0; i < links.length; i++) {
            if (links[i] === btn || links[i].hasAttribute('data-sl-theme-toggle')) continue;
            var h = links[i].getAttribute('href') || '';
            if (/(^|\/)(chat|notification)(\/|$|\?|#)/.test(h)) hit = links[i];
        }
        if (hit && hit.parentElement) return { parent: hit.parentElement, before: hit.nextSibling };

        // 退路 1：FontAwesome 渲染后的图标类名
        var icon = bar.querySelector('.fa-bell, .fa-envelope');
        if (icon) {
            var host = icon.closest('a, button') || icon;
            if (host && host.parentElement) return { parent: host.parentElement, before: host.nextSibling };
        }
        // 退路 2：插到头像左边
        var av = bar.querySelector('.avatar');
        if (av) {
            var box = av.closest('span') || av;
            if (box && box.parentElement) return { parent: box.parentElement, before: box };
        }
        // 退路 3：右侧容器末尾
        var right = bar.querySelector('.right') || bar;
        return { parent: right, before: null };
    }

    function makeButton() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sl-theme-toggle';
        btn.setAttribute('data-sl-theme-toggle', '1');
        // 内联样式：脚本要能独立工作（样式表里没有这个类的规则）
        btn.style.cssText = [
            'display:inline-flex', 'align-items:center', 'justify-content:center',
            'flex:0 0 auto', 'align-self:center', 'width:2rem', 'height:2rem',
            'margin:0 .3rem', 'padding:0', 'background:transparent',
            'border:1px solid currentColor', 'border-radius:99px', 'color:inherit',
            'cursor:pointer', 'opacity:.75', 'transition:opacity .2s ease'
        ].join(';');

        btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', function () { btn.style.opacity = '.75'; });
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();                       // 顶栏有"点外部关闭下拉"之类的监听器
            var next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
            saveMode(next);
            switchMode(function () { applyMode(next); paint(btn, next); });
        });

        paint(btn, getMode());
        return btn;
    }

    function ensureButton() {
        if (!CONFIG.showToggle || !isMain) return;
        var bar = document.querySelector('.top-bar');
        if (!bar) return;

        var btn = bar.querySelector('[data-sl-theme-toggle]');
        if (!btn) btn = makeButton();

        // 位置纠偏：首屏渲染竞态时按钮可能先挂到了 .top-bar 上，Vue 重建也可能挪走它。
        // 原来只检查"在不在顶栏里"、从不核对位置 → 它就一直飘在栏外。现在每次核对并搬回去。
        var spot = findSpot(bar, btn);
        if (btn.parentElement !== spot.parent || btn.nextSibling !== spot.before) {
            spot.parent.insertBefore(btn, spot.before);
        }
        if (btn.getAttribute('data-mode') !== getMode()) paint(btn, getMode());
    }

    /* ======================================================================
       三、切换：统一短过渡 + 切完立刻校准
       为什么不能直接切：本样式给大量元素挂了 0.25~0.5s 的 transition，
       各元素时长不一，切深浅时会"糊"好几帧，看起来又慢又像字色延迟。
       做法：切换那一帧给 <html> 加 .sl-theme-switching，样式里把**所有**元素的
       过渡统一压成 --sl-switch-duration（默认 .14s），切完就移除。
       对比度守卫放在过渡结束之后跑：过渡过程中 getComputedStyle 读到的是中间值，
       那时算对比度会算错（这一点也解释了为什么"晚一步"才变色的观感）。
       ====================================================================== */
    function switchMode(apply) {
        if (!root) { apply(); return; }
        root.classList.add('sl-theme-switching');
        apply();
        var ms = switchDurationMs();
        setTimeout(function () {
            runGuard();                                   // 过渡已结束，读到的是最终颜色
            root.classList.remove('sl-theme-switching');
        }, ms + 20);
    }

    /* ======================================================================
       四、对比度守卫（只在深色下工作）
       思路：直接量"最终算出来的"前景色与最近的实心背景色，两边都亮或都暗就修前景色
             （保留色相，只调明度）。只处理"有直接文字子节点"的元素，数量级可控。
       ====================================================================== */
    function parseColor(str) {
        if (!str) return null;
        var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/i.exec(str.trim());
        if (!m) return null;
        var a = m[4] === undefined ? 1 : (m[4].indexOf('%') >= 0 ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
        return { r: +m[1], g: +m[2], b: +m[3], a: a };
    }

    function luminance(c) {
        var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }

    function contrastRatio(a, b) {
        var l1 = luminance(a), l2 = luminance(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    function towardWhite(c, t) { return { r: c.r + (255 - c.r) * t, g: c.g + (255 - c.g) * t, b: c.b + (255 - c.b) * t, a: 1 }; }
    function towardBlack(c, t) { return { r: c.r * (1 - t), g: c.g * (1 - t), b: c.b * (1 - t), a: 1 }; }
    function toCss(c) { return 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')'; }

    function effectiveBg(el) {
        var node = el;
        while (node && node.nodeType === 1) {
            var bg = parseColor(getComputedStyle(node).backgroundColor);
            if (bg && bg.a >= 0.5) return bg;
            node = node.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
    }

    function hasOwnText(el) {
        for (var n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
        }
        return false;
    }

    // SVG 里的文字（图表坐标轴、图例、数值）用的是 fill 而不是 color，
    // 所以必须单独处理 —— 否则"累积通过 / 200 / 100 / 0"这类坐标轴文字永远修不到。
    function isSvgText(el) {
        return el.namespaceURI === 'http://www.w3.org/2000/svg' &&
               (el.tagName === 'text' || el.tagName === 'tspan' || el.tagName === 'TEXT' || el.tagName === 'TSPAN');
    }

    function fixOne(el) {
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return false;

        // ★ 洛谷给彩色标签（比赛类型 / 难度 / 来源…）用的是**内联样式**：
        //      style="background-color: rgb(255,193,22); color: rgb(51,51,51)"
        //   那是它按底色算出来的前景色（getForeground），语义正确。
        //   守卫若覆盖它，就会"把彩底上的字改成另一种颜色"（用户："字体颜色有问题"）。
        //   所以：**元素自己带内联 color 的一律不动**。
        //   （守卫自己写过的会带 data-sl-fixed，前面已经跳过了。）
        if (CONFIG.guardSkipInlineColor && el.style && el.style.color) return false;
        if (parseFloat(cs.opacity) < 0.15) return false;

        var svg = isSvgText(el);
        var prop = svg ? 'fill' : 'color';
        var fg = parseColor(svg ? cs.fill : cs.color);
        if (!fg || fg.a < 0.5) return false;
        if (svg && (cs.fill === 'none' || cs.fill === '')) return false;

        var bg = effectiveBg(el);
        if (contrastRatio(fg, bg) >= CONFIG.guardMinRatio) return false;

        var bgLum = luminance(bg);
        var target = null;
        for (var i = 1; i <= 10 && !target; i++) {
            var cand = bgLum < 0.5 ? towardWhite(fg, i / 10) : towardBlack(fg, i / 10);
            if (contrastRatio(cand, bg) >= (CONFIG.guardTargetRatio || CONFIG.guardMinRatio + 0.5)) target = cand;
        }
        if (!target) target = bgLum < 0.5 ? { r: 238, g: 242, b: 247, a: 1 } : { r: 31, g: 35, b: 41, a: 1 };

        el.style.setProperty(prop, toCss(target), 'important');
        el.setAttribute('data-sl-fixed', '1');
        el.setAttribute('data-sl-prop', prop);        // 还原时要知道当初改的是哪个属性
        return true;
    }

    // 复位：把之前守卫写过的内联色全部撤掉，让它们按**当前规则**重新判定。
    // 本轮新增了"跳过内联 color"的规则，但旧版本已经往彩底标签上写过颜色 ——
    // 不撤掉的话，那些标签即使刷新也还是错的（内联 !important 会一直赢）。
    function resetGuardMarks() {
        var fixed = document.querySelectorAll('[data-sl-fixed]');
        for (var k = 0; k < fixed.length; k++) {
            try {
                fixed[k].style.removeProperty(fixed[k].getAttribute('data-sl-prop') || 'color');
                fixed[k].removeAttribute('data-sl-fixed');
                fixed[k].removeAttribute('data-sl-prop');
            } catch (e) { /* 单个失败不影响 */ }
        }
    }

    function runGuard() {
        if (!CONFIG.contrastGuard || !isMain) return 0;
        if (!isDarkNow()) {
            var fixed = document.querySelectorAll('[data-sl-fixed]');
            for (var k = 0; k < fixed.length; k++) {
                fixed[k].style.removeProperty(fixed[k].getAttribute('data-sl-prop') || 'color');
                fixed[k].removeAttribute('data-sl-fixed');
                fixed[k].removeAttribute('data-sl-prop');
            }
            return 0;
        }
        var all = document.querySelectorAll('body *');
        var n = 0, limit = Math.min(all.length, CONFIG.guardMaxNodes);
        for (var i = 0; i < limit; i++) {
            var el = all[i];
            if (el.hasAttribute('data-sl-fixed')) continue;
            var tag = el.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'PATH' || tag === 'svg') continue;
            if (!hasOwnText(el)) continue;
            try { if (fixOne(el)) n++; } catch (e) { /* 单个失败不影响整体 */ }
        }
        if (CONFIG.debug && n) console.debug('[smart-luogu] 对比度守卫修正了 ' + n + ' 处文字颜色');
        return n;
    }

    var guardTimer = null;
    function scheduleGuard(delay) {
        if (!CONFIG.contrastGuard) return;
        if (guardTimer) clearTimeout(guardTimer);
        guardTimer = setTimeout(function () {
            guardTimer = null;
            if ('requestIdleCallback' in window) requestIdleCallback(runGuard, { timeout: 800 });
            else runGuard();
        }, delay === undefined ? CONFIG.mutationDelay : delay);
    }

    /* ======================================================================
       五、启动
       ====================================================================== */
    // document-start 阶段 <html> 可能还没建好，等它出现就立刻写属性（深色用户不闪白）
    function whenRoot(fn) {
        if (document.documentElement) { fn(); return; }
        var mo = new MutationObserver(function () {
            if (document.documentElement) { mo.disconnect(); fn(); }
        });
        mo.observe(document, { childList: true, subtree: true });
    }

    whenRoot(function () {
        applyMode(getMode());
        if (!isMain) return;                       // 子站（有题/网校）另一套前端，不介入

        if (CONFIG.showToggle) {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
            else ensureButton();
            setInterval(ensureButton, 1000);       // SPA 会重建顶栏，低频纠偏
        }

        resetGuardMarks();                         // 先撤掉旧版本写过的内联色（含误改的彩底标签）
        scheduleGuard(120);                        // 首屏尽早跑一次，别让文字晚一步才变亮

        var mo = new MutationObserver(function () { scheduleGuard(); });
        if (document.body) mo.observe(document.body, { childList: true, subtree: true });
        else document.addEventListener('DOMContentLoaded', function () {
            mo.observe(document.body, { childList: true, subtree: true });
        }, { once: true });

        try {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { scheduleGuard(120); });
        } catch (e) { /* 老浏览器忽略 */ }
    });

    // 排查用：控制台执行 __slDebug()
    window.__slDebug = function () {
        return {
            mode: getMode(),
            attr: root && root.getAttribute('data-sl-theme'),
            isDark: isDarkNow(),
            switchDurationMs: switchDurationMs(),
            fixedCount: document.querySelectorAll('[data-sl-fixed]').length
        };
    };
})();
