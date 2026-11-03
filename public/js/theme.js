/* Apply the saved light/dark theme before the page paints (no flash). */
(function () { try { var t = localStorage.getItem('ka_theme'); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) {} })();
