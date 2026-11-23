(function () {
    const paths = {
        sidebar: 'M4 3h16v18H4zM9 3v18', back: 'm14 6-6 6 6 6M8 12h13', forward: 'm10 6 6 6-6 6M16 12H3',
        folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3zM3 10h18',
        file: 'M5 3h9l5 5v13H5zM14 3v6h5', edit: 'M12 5H5v15h15v-7M10 14l1-4L19 2l3 3-8 8z',
        search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6', refresh: 'M20 9a8 8 0 1 0 0 6M20 3v6h-6',
        more: 'M4 12h.1M12 12h.1M20 12h.1', share: 'M12 16V3m-5 5 5-5 5 5M5 12v8h14v-8',
        plus: 'M12 4v16M4 12h16', close: 'm6 6 12 12M18 6 6 18', copy: 'M9 8h11v13H9zM15 8V3H3v13h6',
        terminal: 'm5 7 5 5-5 5M12 18h7', settings: 'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
        chevron: 'm9 5 7 7-7 7', expand: 'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7',
        diff: 'M8 3v18M4 7h8M15 17h6', shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM9 12l2 2 4-4',
        up: 'M12 19V5m-6 6 6-6 6 6', stop: 'M6 6h12v12H6z'
    };
    window.mydexIcon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.file); if (name === 'more')
        svg.style.strokeWidth = '3'; svg.append(path); return svg; };
    document.querySelectorAll('[data-icon]').forEach(node => node.append(window.mydexIcon(node.dataset.icon)));
}());
