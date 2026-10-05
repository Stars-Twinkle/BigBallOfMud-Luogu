// ==UserScript==
// @name       BigBallOfMud Luogu
// @namespace    bigballofmud-luogu
// @version      20261005.19
// @updateURL    https://raw.githubusercontent.com/Stars-Twinkle/BigBallOfMud-Luogu/main/bigballofmud-luogu-switch.user.js
// @downloadURL  https://raw.githubusercontent.com/Stars-Twinkle/BigBallOfMud-Luogu/main/bigballofmud-luogu-switch.user.js
// @homepageURL  https://github.com/Stars-Twinkle/BigBallOfMud-Luogu
//                ↑ 更新走仓库 raw。篡改猴的"检查更新"默认每 24 小时一次，
//                  发现 @version 变大就自动装上（本项目的 publish.ps1 每次发布自动 +0.01）。
//                  若你的网络访问不了 raw.githubusercontent.com，把上面两行换成 jsDelivr 镜像：
//                  https://cdn.jsdelivr.net/gh/Stars-Twinkle/BigBallOfMud-Luogu@main/bigballofmud-luogu-switch.user.js
// @description  配合 bigballofmud-luogu.user.css 使用（样式仍由 Stylus 提供，本脚本只管"行为"）。两件事：① 在顶栏"私信、通知"右边放一个可点的三态配色开关（跟随系统/深色/浅色，选择被记住）；② 深色下运行"对比度守卫"，自动修掉洛谷写死的浅字浅底/深字深底。
// @author       acerkaio
// @license      CC BY-NC-SA
// @match        https://www.luogu.com.cn/*
// @match        https://class.luogu.com.cn/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
//                ↑ 用篡改猴的跨域存储记住「主题中景图」的地址：
//                  首页（旧前端）与网校（另一套前端）自己页面上都没有这个变量，
//                  只能靠在这里存一份、两个域名共享（localStorage 是按域名隔离的，读不到）。
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
 *   · 覆盖主站与**网校**（class.luogu.com.cn）：网校是独立域名、独立前端，
 *     同样靠 color-scheme 驱动样式里的 light-dark()，所以模式要写进去。
 *   · 切换按钮两个站点都有，但落点不同：
 *       主站 → 顶栏右侧（私信/通知的右面）
 *       网校 → 有侧边栏时：nav.lfe-body 里"学习"（a[href$="/learn"]）的下面
 *              无侧边栏（主页）时：nav.user-nav 里客服（a[href$="/service"]）的左边
 *   · 对比度守卫仍只跑主站（它按计算值改内联色，网校那套 DOM 未做验证）。
 *   · 切换那一帧往 <html> 加 .sl-theme-switching（样式里定义了一段"统一短过渡"）
 *   · 深色下给个别元素写内联 color（对比度守卫）
 */

(function () {
    'use strict';

    /* ====================== 可调配置 ====================== */
    var CONFIG = {
        showToggle: true,          // 是否在顶栏放配色开关
        contrastGuard: true,       // 是否启用深色下的对比度守卫
        guardSkipInlineColor: true, // 跳过"洛谷自己写了内联 color"的元素
        // 跳过"彩色徽章 / 标签"整棵子树：它们的底色是语义色（黄=IOI、红=官方比赛…），
        // 前景由洛谷按底色配好（白字或深字）。守卫按"对比度"去量这些彩底毫无意义，
        // 只会把白字改成深字（用户："这东西是黑的显然不对"）。
        //   旧首页：.am-badge + .lg-bg-*      新前端：[class*="lcolor-bg-"]
        guardSkipColorChip: true,
        // ⚠️ 这两个值是**一对跷跷板**，调过头就出事（两个方向的用户反馈都来过）：
        //   · 4.5 / 不设 target：偏灰的次要文字会被放过 → "这些文字不应该是白的吗"
        //   · 6.0 / 7.5        ：连次要文字一起拉到接近纯白，**层次全没了** → "所有正文都写成白色"
        //   结论：**层次由样式负责**（--lg-text 给正文、--lg-text-weak 给次要），
        //   守卫只修"真的读不清"的，所以门槛回到 WCAG AA，修正目标也克制一点。
        guardMinRatio: 4.5,        // WCAG AA 正文标准：低于它才动手
        guardTargetRatio: 6.0,     // 修正到"清楚可读"即可，不追求纯白
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
    // 网校（class.luogu.com.cn）是独立域名、独立前端：那里没有主站顶栏，
    // 但**也需要切换按钮**（用户："切换按钮消失，需要重写，到侧边栏学习图标的下面"）。
    var isSchool = location.hostname === 'class.luogu.com.cn';

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
        // ★ root 是 document-start 那一刻取的，那时 <html> 可能还没建好（null）。
        //   一旦是 null，这里以前直接 return —— 结果"这一页永远没有 data-sl-theme"，
        //   页面按**系统**配色渲染，而切换按钮显示的却是**用户选的**模式，
        //   于是出现"按钮状态一样、两页明暗却相反"（用户："模式是一样的"但渲染不同）。
        //   现在每次调用都补取一次，取到就落属性。
        if (!root) root = document.documentElement;
        if (!root) return;
        if (mode === 'auto') root.removeAttribute('data-sl-theme');
        else root.setAttribute('data-sl-theme', mode);
        /* ★ 双保险：**直接写内联 color-scheme**。
           样式里那两条 :root[data-sl-theme] 规则负责主题三态，但一旦它们因为任何原因失效
           （历史上真的发生过：规则被嵌进 :root { } 里，解析成后代选择器后永不匹配），
           内联值仍然能驱动 light-dark()，不至于"点了没反应"。 */
        try {
            if (mode === 'auto') root.style.removeProperty('color-scheme');
            else root.style.setProperty('color-scheme', mode);
        } catch (e) { /* 忽略：个别环境不允许写内联也就算了 */ }
    }

    function saveMode(mode) {
        try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 忽略 */ }
    }

    function isDarkNow() {
        if (!root) root = document.documentElement;
        var m = root && root.getAttribute('data-sl-theme');
        if (m === 'dark') return true;
        if (m === 'light') return false;
        try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
    }

    // 切换过渡时长：优先读样式里的 --sl-switch-duration，读不到用兜底值。
    // 这样"时长"只写在样式里一处，脚本跟着走，不会两边不一致。
    function switchDurationMs() {
        try {
            if (!root) root = document.documentElement;
            if (!root) return CONFIG.switchFallbackMs;
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

    /* 网校有**两种布局**，落点分别按用户 DevTools 实证：
       ── 布局 A：带侧边栏（学习中心 /learn、播放页 /classroom）
          <nav class="lfe-body" style="background-color: rgb(52,73,94); color: rgb(221,221,221);">
            <a href="/"       class="route-link-active color-none">
            <a href="/course" class="color-none">
            <a href="/learn"  class="color-none">        ← 学习
          要求：放在"学习"图标的**下面**。
       ── 布局 B：主页（无侧边栏）
          <div class="header-layout tiny"><div class="container">
            <nav class="user-nav">
              <a href="/service">    <svg class="svg-inline--fa fa-headset">   ← 客服（耳机）
              <a href="/order/cart"> …
              …头像…
          要求：放在**客服图标的左边**（用户："主页没有侧边栏，放在客服图标的左边"）。
       返回 layout 字段，供调用处决定竖排/横排样式。 */
    function findSpotSchool() {
        // 布局 A：侧边栏
        var nav = document.querySelector('nav.lfe-body');
        if (nav) {
            var learn = nav.querySelector('a[href$="/learn"]');
            if (learn && learn.parentElement) return { parent: learn.parentElement, before: learn.nextSibling, layout: 'side' };
            var links = nav.querySelectorAll('a[href]');
            if (links.length) {
                var last = links[links.length - 1];
                return { parent: last.parentElement, before: last.nextSibling, layout: 'side' };
            }
            return { parent: nav, before: null, layout: 'side' };
        }
        // 布局 B：顶栏 user-nav（主页）—— 插到客服（/service）左边
        var userNav = document.querySelector('nav.user-nav');
        if (userNav) {
            var svc = userNav.querySelector('a[href$="/service"]');
            if (svc && svc.parentElement) return { parent: svc.parentElement, before: svc, layout: 'top' };
            return { parent: userNav, before: userNav.firstChild, layout: 'top' };
        }
        return null;
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
        if (!CONFIG.showToggle) return;

        // —— 网校：侧边栏（学习下面）或顶栏（客服左边），两套布局都覆盖 ——
        if (isSchool) {
            var sp = findSpotSchool();
            if (!sp) return;                                   // 两套宿主都没出现，下一轮再试
            var host = sp.parent;
            var sb = host.querySelector('[data-sl-theme-toggle]') ||
                     document.querySelector('[data-sl-theme-toggle]');
            if (!sb) { sb = makeButton(); sb.className = 'sl-theme-toggle sl-theme-toggle-school'; }
            if (sp.layout === 'side') {
                // 竖排图标列：块级 + 居中
                sb.style.display = 'flex';
                sb.style.margin = '.5rem auto';
                sb.style.width = '2.2rem';
                sb.style.height = '2.2rem';
            } else {
                // 顶栏横排：跟旁边的图标按钮同一尺寸与间距
                sb.style.display = 'inline-flex';
                sb.style.margin = '0 .35rem';
                sb.style.width = '2rem';
                sb.style.height = '2rem';
            }
            if (sb.parentElement !== sp.parent || sb.nextSibling !== sp.before) {
                sp.parent.insertBefore(sb, sp.before);
            }
            if (sb.getAttribute('data-mode') !== getMode()) paint(sb, getMode());
            return;
        }

        if (!isMain) return;
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
       二·五、网校：剥掉"内联主题色"
       ----------------------------------------------------------------------
       网校把主题色写在**内联 style** 上（用户 DevTools 实证）：
           <nav class="lfe-body" style="background-color: rgb(52,73,94); color: rgb(221,221,221)">
           <main class="wrapped lfe-body" style="background-color: rgb(239,239,239)">
           <div  class="wrapped lfe-body" style="background-color: rgb(51,51,51)">
       内联样式只有 !important 能压，而本项目**不允许对 color 用 !important**
       （那会把彩底标签的白字压黑）。所以在网校这一侧改由脚本把这两个内联属性**删掉**，
       让样式表（含 light-dark()）接手 —— 这是"两边各做该做的事"。
       ★ 只删 background-color / background-image / color 这三个属性，其它内联样式不碰。
       ====================================================================== */
    var SCHOOL_STRIP_SEL = [
        'nav.lfe-body',
        '.main-container',
        '.wrapped.lfe-body',
        'main.wrapped.lfe-body',
        /* ★ 标签栏的**未选中项**也带内联 color（配深底导航用的浅色），
           浅色模式下会变成"浅字浅底"。这里一并剥掉，颜色交给样式表按属性给。
           注意**排除 .selected**：它的内联背景/文字色是状态色，必须原样保留。 */
        '.tab .items > li:not(.selected)',
        '.category .items > li:not(.selected)',
        /* ★ 首页那个 <main> 有时**没有 class**（两次 DevTools 截图不一致），
           所以除了 main.wrapped.lfe-body，还要按结构再列两条。 */
        '#app.lfe-vars > main',
        '.homepage-main > main'
    ].join(',');

    function stripInlineTheme() {
        if (!isSchool) return;
        var nodes = document.querySelectorAll(SCHOOL_STRIP_SEL);
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i], st = el.style;
            if (!st) continue;
            // 状态项（选中标签等）的内联色必须保留
            if (el.classList && el.classList.contains('selected')) continue;
            if (st.backgroundColor) st.removeProperty('background-color');
            if (st.backgroundImage) st.removeProperty('background-image');
            if (st.color) st.removeProperty('color');
        }
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

        // ★ 彩色徽章 / 标签整棵子树一律不动（见上面 guardSkipColorChip 的说明）。
        //   用 closest 一次覆盖"徽章本身 + 它内部的文字节点"。
        if (CONFIG.guardSkipColorChip &&
            el.closest('.am-badge, [class*="lg-bg-"], [class*="lcolor-bg-"]')) return false;
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
    /* ======================================================================
       六·二、个人主页「比赛等级分趋势图」的浮窗：位置改成"跟着指针"
       ----------------------------------------------------------------------
       背景（用户多轮实测 + 控制台诊断，样式侧已尽力但无法解决）：
         该图浮窗由 Chart.js + Vue 组件 UserEloChartTooltip 渲染为 div.tooltip，
         它的 inline style 由组件按**文档坐标**写入：
             left = canvas.rect.left + pageXOffset + caretX
             top  = canvas.rect.top  + pageYOffset + caretY - height/2
         但其 absolute 包含块并非文档 —— 13 条实采记录联立解出的包含块原点稳定落在
         图表卡片附近，于是"文档坐标"被当成"卡内坐标"使用，浮窗整体偏出视口：
             实测 rect(视口).y ≈ 2066，而视口高度只有 668 ⇒ 永远看不见。
       样式侧试过并已回滚：清 backdrop-filter/filter/transform/contain/will-change/isolation、
         放开祖先 overflow、把卡片改 static（后者把卡片撑满整屏）。
       ⇒ 这里走"指针驱动"：把浮窗钉成 position: fixed（其包含块为视口；祖先已确认没有任何
         transform / filter / backdrop-filter，不会被别的元素捕获），left/top 每 120ms 按当前
         指针位置写一次（右下 14px，并做视口内收边）。
       作用域：只认 div.tooltip（站内只有该组件用它），元素被 Vue 重建时幂等重设；
               其它页面与组件零影响。
       ====================================================================== */
    function fixEloTooltip() {
        /* ★ 第三版（终结版）—— 不抢样式，改成"搬家"。
           历史：
             v1 跟着鼠标写 left/top → 用户「咋飞这么远」（Chart.js 的 caret 指数据点，不是鼠标）；
             v2 保留洛谷原坐标再换算 → 仍不准，且实测出现"位置飘忽 / 挡住内容"，
                根因是**在跟 Vue 抢 inline style**（洛谷每次 hover 都重写 left/top，我也写，胜负不定）。
           v3 思路：不动样式，只把浮窗**搬出所有定位祖先**。
             洛谷组件的坐标算法是：left/top = canvas.rect + pageXOffset/pageYOffset + caret
             —— 也就是**文档坐标**，本来就完全正确；
             只因 .tooltip 的 absolute 包含块是图表卡片（卡片带 position: relative），
             这份文档坐标被当成"卡内坐标"用，才整体错位到视口之外。
             把它移到 <html> 下（html 不是定位祖先）后，包含块就是初始包含块＝文档，
             洛谷的坐标立刻正确 —— 我们一行样式都不需要改，也不会与 Vue 打架。
           ★ 幂等 + 低频（200ms）：元素被 Vue 重建时会被再搬一次；已在 <html> 下则什么都不做。
           ★ 只认 div.tooltip（站内只有该组件用它），对其它页面与组件零影响。 */
        function hoist() {
            var t = document.querySelector("div.tooltip");
            if (!t) return;
            if (t.parentNode !== document.documentElement) {
                document.documentElement.appendChild(t);
            }
        }
        setInterval(hoist, 500);   // 只在有浮窗时才有实际动作
    }

    /* ======================================================================
       背景图：样式没写死时，抓洛谷主题商店设置的背景图顶上
       ----------------------------------------------------------------------
       规则（用户要求）：
         · 样式里 --sl-bg-image **写了值** ⇒ 一律不动，脚本完全不插手；
         · 样式里留空 ⇒ 读 .theme-page 上的 --theme-body-image（洛谷把主题图放这里，
           实测：.theme-page { --theme-body-image: url("…/luogu4-bg-l.jpg") }，
           真正画图的是 .theme-page::before，而 html 上取不到这个变量）；
         · 连主题图也没有 ⇒ 用它自己的官方默认图（浅/深两张）。
       把结果写到 <html> 的行内 --sl-bg-active，样式那边画布用
       var(--sl-bg-active, var(--sl-bg-image)) 消费它。
       ====================================================================== */
    var BG_CACHE_KEY = 'sl-theme-bg-image';
    // 洛谷自己的默认中景图：用户把主题里的地址**清空**时要回滚到它（用户：「地址如果是空的要回滚成默认」）。
    var BG_FALLBACK_LIGHT = 'url("https://cdn.luogu.com.cn/images/bg/fe/luogu4-bg-l.jpg")';
    var BG_FALLBACK_DARK  = 'url("https://cdn.luogu.com.cn/images/bg/fe/luogu4-bg-d.jpg")';
    // 跨域名共享的缓存读写：优先用篡改猴的 GM 存储（www 与 class 两个域名能互相看到）。
    // ★ 只用**同步**的旧式 GM_getValue / GM_setValue：新式的 getValue / setValue（挂在 GM 对象上）返回 Promise，
    //   这个读取函数是同步的，拿到 Promise 会直接当 URL 用而坏掉。
    // 没有 GM 时退回本域名的 localStorage。
    function bgCacheGet() {
        try { if (typeof GM_getValue === 'function') return GM_getValue(BG_CACHE_KEY, '') || ''; } catch (e) { /* 忽略 */ }
        try { return localStorage.getItem(BG_CACHE_KEY) || ''; } catch (e) { return ''; }
    }
    function bgCacheSet(v) {   // v 传空串 = 作废这条缓存
        try { if (typeof GM_setValue === 'function') { GM_setValue(BG_CACHE_KEY, v); return; } } catch (e) { /* 忽略 */ }
        try { localStorage.setItem(BG_CACHE_KEY, v); } catch (e) { /* 忽略 */ }
    }   // 记下最近一次从主题读到的中景图 URL（首页没有 .theme-page，靠它兜）

    /* 当前页地址，用来判断 SPA 是否换了页面 */
    var bgLastHref = '';

    function syncThemeBackground() {
        try {
            var el = document.documentElement;
            if (!el) return;
            // ① 样式里写死了 --sl-bg-image ⇒ 撤掉我们写过的值，交回样式
            var own = getComputedStyle(el).getPropertyValue('--sl-bg-image').trim();
            if (own && own !== 'none') { el.style.removeProperty('--sl-bg-active'); return; }

            var url = '';
            var useDefault = false;   // 主题里地址被清空时要回滚默认图
            if (isMain) {
                // ② 主站：**每次页面更新都先把缓存作废，然后重新拉一次中景图**（用户要求），
                //    保证缓存里始终是"主站最近一次看到的真实值"。
                //    判据用地址变化：SPA 换页 / 首屏都算一次更新；同一个页面内 300ms 的高频调用不作废。
                // ★ 页面更新时**重新拉一次**中景图，但**不要先把缓存清空** ——
                //   首轮 .theme-page 还没渲染，清空后读不到就只能退到官方兜底图，
                //   用户会看到「默认图闪一瞬间」。这里改成：先用手上的缓存，
                //   本页抓到新值就覆盖它（主题真变了下一轮就换过来）。
                if (bgLastHref !== location.href) bgLastHref = location.href;
                // 洛谷把主题值**内联**写在 .theme-page 的 style 属性上
                // （实测：style="--theme-body-back:#f0f4fa; --theme-body-image:url(...)"），
                // 所以先读属性（快、不等渲染），再退回计算值。
                var tp = document.querySelector('.theme-page');
                if (!tp) {
                    // ★ 情形 A：这一页**根本没有** .theme-page（旧首页），或新前端还没渲染出来。
                    //   此时若写默认图，会先闪一下默认图再被真图替换 ⇒ 所以只用手上的缓存；
                    //   缓存也空就什么都不写（画布只剩底色）。
                    url = bgCacheGet() || '';
                } else {
                    var raw = String(tp.getAttribute('style') || '');
                    var m = /--theme-body-image:\s*url\((['"]?)(.*?)\1\)/.exec(raw);
                    if (!m) m = /url\((['"]?)(.*?)\1\)/.exec(getComputedStyle(tp).getPropertyValue('--theme-body-image') || '');
                    url = m && m[2] ? m[2] : '';
                    if (url) {
                        bgCacheSet(url);                              // 抓到了就刷新缓存
                    } else {
                        // ★ 情形 B：.theme-page 在，但里面**没有图** —— 用户在主题里把地址清空了。
                        //   这时要回滚成洛谷自己的默认中景图（用户：「地址如果是空的要回滚成默认」），
                        //   并把缓存清掉，免得别处（首页 / 网校）继续用旧地址。
                        bgCacheSet('');
                        url = '';
                        useDefault = true;
                    }
                }
            } else {
                // ③ 网校：**不复用抓取逻辑，直接复用主站留下的缓存**（用户要求）。
                url = bgCacheGet() || '';
            }

            // ④ 缓存也没有 ⇒ 洛谷官方默认图（浅 luogu4-bg-l / 深 luogu4-bg-d）
            // ① 拿到了地址 ⇒ 用它；
            // ② 主题里被清空 ⇒ 回滚成洛谷默认中景图（useDefault）；
            // ③ 页面还没渲染出来又没有缓存 ⇒ 什么都不写，避免先闪一下默认图。
            var want = url ? 'url("' + url + '")' : (useDefault ? (isDarkNow() ? BG_FALLBACK_DARK : BG_FALLBACK_LIGHT) : '');
            if (!want) { if (el.style.getPropertyValue('--sl-bg-active')) el.style.removeProperty('--sl-bg-active'); return; }
            if (el.style.getPropertyValue('--sl-bg-active') !== want) el.style.setProperty('--sl-bg-active', want);
        } catch (e) { /* 忽略 */ }
    }
    /* ======================================================================
       主题编辑器（/theme/…）微调
       ----------------------------------------------------------------------
       用户要求两件事：
         ① 把「卡片毛玻璃」那一行**隐藏**（它会让渲染不对，默认的「标准」才是对的）；
         ② 把「中景图片」这个描述的文案改成「背景图」。
       做法：编辑器里这两处都没有能稳定指向它们的类名（那一行只是 .l-form-layout，
             和「中景淡出」等同级同构），所以按**文案**定位，只在 /theme/ 路径下动手。
       ====================================================================== */
    // 要整行隐藏的设置项（按文案**前缀**匹配 —— 标题里常带当前值，如「渐变角度（0°）」）：
    // 这些都是背景图相关的调节项，美化自己管背景，留着只会互相冲突（用户：「这些设置都没用，
    // 为防止冲突，删掉隐藏」）。
    var THEME_HIDE_PREFIX = [
        '卡片毛玻璃',   // 必须先拉回「标准」再隐藏（美化是照标准写的）
        '渐变角度',
        '中景亮度',
        '中景淡出',
        '图片重复',
        '图片尺寸',
        '图片位置',     // 覆盖「图片位置 X（0%）」与「图片位置 Y（0%）」两项
        '背景底色',     // 用户：这些设置也没用，隐掉
        '中景颜色',
        '文字颜色',     // 在「亮色导航」块里（Logo 颜色保留，那一项有用）
        '亮色主体',     // 这一块的标题（下面两项也各自隐藏）
    ];
    var THEME_RENAME = { '中景图片': '背景图' };  // 文案替换

    function tweakThemeEditor() {
        if (!/\/theme(\/|$)/.test(location.pathname)) return;
        try {
            // ★ 扫全页：原来限定在 .adjust-bars / .l-form-layout 里，漏掉了「中景图片」那个 label
            // ★ 选择器必须带上 .image-label > span：那个「中景图片」是**裸 span**，没有 lfe-caption 类
            //   （结构：div.image-label > span + div.image-switch；它带 data-v-* 哈希，项目禁用，只能用结构定位）
            var labels = document.querySelectorAll('.lfe-caption, .lfe-h3, label, .image-label > span');
            for (var i = 0; i < labels.length; i++) {
                var el = labels[i];
                var txt = (el.textContent || '').trim();
                var hit = false;
                for (var p = 0; p < THEME_HIDE_PREFIX.length; p++) {
                    if (txt.indexOf(THEME_HIDE_PREFIX[p]) === 0) { hit = true; break; }
                }
                if (hit) {
                    // 找到承载这一行的那层（.l-form-layout 是那一行的容器）
                    // ★ 取「最小单元」：从 label 逐级向上，选第一个内部**只含这一个 .lfe-caption** 的祖先。
                    //   直接 closest('.l-form-layout') 会踩坑 —— 区块标题 .lfe-h3 不在 .l-form-layout 里，
                    //   上溯会命中包住整块的大容器，把一整块设置全隐藏（用户：「会闪一下然后啥都没了」）。
                    var row = null;
                    if (el.classList.contains('lfe-h3')) {
                        row = el;                      // 区块标题：只隐藏它自己
                    } else {
                        var cur = el.parentElement;
                        while (cur && cur !== document.body) {
                            if (cur.querySelectorAll('.lfe-caption').length <= 1) { row = cur; break; }
                            cur = cur.parentElement;
                        }
                        if (!row) row = el.parentElement;   // 兜底：至少别动到更大的容器
                    }
                    // ★ 关键：先把档位拉回「标准」再隐藏。本项目的美化是照「标准」写的，
                    //   用户若曾选过「关闭 / 轻量」，光是隐藏那一行并不会把值改回来，渲染照样不对。
                    //   做法：在行内找到文案含「标准」的那个单选项，只有它没被选中时才模拟点它一次
                    //   （用 label.click() 走洛谷自己的交互，避免直接改状态与 Vue 不同步；
                    //     点了也只是改了编辑器里的待保存状态，仍需用户点「应用主题」才生效）。
                    if (row) {
                    // ★「文字颜色」特例：它同时影响图标；而深色模式下不管选什么颜色，
                    //   最后都会渲染成白色 —— 与其留着一个改了也没用的颜色选择器，
                    //   不如把它固定回默认的白色，再把这一项隐藏（用户要求）。
                    if (txt.indexOf('文字颜色') === 0) {
                        var colorInputs = row.querySelectorAll('input[type="color"], input[type="text"], input');
                        for (var c = 0; c < colorInputs.length; c++) {
                            var ci = colorInputs[c];
                            var cur = String(ci.value || '').trim().toLowerCase();
                            if (cur && cur !== '#ffffff' && cur !== 'rgb(255, 255, 255)') {
                                try { ci.value = '#ffffff'; } catch (e2) { /* 忽略 */ }
                                try { ci.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) { /* 忽略 */ }
                                try { ci.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) { /* 忽略 */ }
                            }
                        }
                    }
                    // 只有「卡片毛玻璃」需要先把档位拉回「标准」
                    if (txt.indexOf('卡片毛玻璃') === 0) {
                        var labels2 = row.querySelectorAll('label');
                        for (var k = 0; k < labels2.length; k++) {
                            if ((labels2[k].textContent || '').indexOf('标准') < 0) continue;
                            var radio = labels2[k].querySelector('input[type="radio"]');
                            var checked = radio ? radio.checked : /checked|active|selected/.test(labels2[k].className);
                            if (!checked) { try { labels2[k].click(); } catch (e) { /* 忽略 */ } }
                            break;
                        }
                    }
                    if (row && row.style.display !== 'none') row.style.display = 'none';
                }
                if (THEME_RENAME[txt] && el.children.length === 0) el.textContent = THEME_RENAME[txt];
            }
            }
        } catch (e) { /* 忽略 */ }
    }
    function whenRoot(fn) {
        if (document.documentElement) { root = document.documentElement; fn(); return; }
        var mo = new MutationObserver(function () {
            if (document.documentElement) {
                mo.disconnect();
                root = document.documentElement;   // ★ 关键：这里必须写回 root，否则后面 applyMode 拿不到元素
                fn();
            }
        });
        mo.observe(document, { childList: true, subtree: true });
    }

    whenRoot(function () {
        applyMode(getMode());
        // ★ 保险：SPA 可能重建 <html> 的属性、或首屏时序异常时漏写，这里再落一次（幂等）。
        var reapply = function () { applyMode(getMode()); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reapply, { once: true });
        else reapply();
        // 有些环境（测试用的假 DOM / 极简浏览器）没有 window.addEventListener，保护一下
        try { window.addEventListener('load', reapply, { once: true }); } catch (e) { /* 忽略 */ }

        // 主题编辑器微调（只在 /theme/ 路径下生效：隐藏「卡片毛玻璃」、把「中景图片」改成「背景图」）
        tweakThemeEditor();
        if (isMain) setInterval(tweakThemeEditor, 500);   // 有 /theme/ 路径守卫，其它页面是空操作

        // 背景图：样式没写死时抓洛谷主题图（SPA 换页与换主题都会重设，低频纠偏）
        syncThemeBackground();
        // 低频轮询即可：换页时靠 href 变化作废缓存，换主题时下一次轮询（或用户刷新）就会读到新值。
        // ★ 这里**不要**再挂「全站 style/class 变化」的 MutationObserver —— 那会让全站每个元素的
        //   样式变化都触发一次 getComputedStyle（强制样式重算），SPA 上几乎每帧触发，
        //   用户实测「刚换回来了，延迟巨大」。当时为了修「替换慢一步」加的，代价远大于收益。
        syncThemeBackground();
        setInterval(syncThemeBackground, 1000);

        // 主题编辑器：那一页是 Vue 现插节点，只监听属性会慢一拍（用户：「还会显示一瞬间」），
        // 所以在这里另挂一个**含 childList** 的观察器，并做 80ms 节流；只在 /theme/ 路径下才挂。
        try {
            if (isMain && /\/theme(\/|$)/.test(location.pathname) && window.MutationObserver) {
                var tePending = false;
                var teObserver = new MutationObserver(function () {
                    if (tePending) return;
                    tePending = true;
                    setTimeout(function () { tePending = false; tweakThemeEditor(); }, 80);
                });
                teObserver.observe(document.documentElement, { childList: true, subtree: true });
            }
        } catch (e) { /* 忽略 */ }

        // 主站个人主页：图表浮窗改成指针驱动定位（详见 六·二）
        if (isMain) fixEloTooltip();

        // 网校：剥内联主题色（SPA 重建节点，低频纠偏）
        if (isSchool) { stripInlineTheme(); setInterval(stripInlineTheme, 1000); }

        // 切换按钮：主站与网校都要（网校挂在侧边栏"学习"下面）
        if (CONFIG.showToggle && (isMain || isSchool)) {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
            else ensureButton();
            setInterval(ensureButton, 1000);       // SPA 会重建导航，低频纠偏
        }

        // 对比度守卫只跑主站：它会按计算值改内联色，网校那套 DOM 没做过验证，不介入。
        if (!isMain) return;

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
