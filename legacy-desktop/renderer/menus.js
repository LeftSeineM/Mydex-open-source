(function () {
    'use strict';
    const menu = document.getElementById('taskMenu');
    let anchor = null;
    let previousExpanded = null;
    function close(restore = false) {
        menu.classList.add('hidden');
        if (anchor) {
            if (previousExpanded === null) anchor.removeAttribute('aria-expanded');
            else anchor.setAttribute('aria-expanded', previousExpanded);
            if (restore && anchor.isConnected) anchor.focus();
        }
        anchor = null;
    }
    function show(target, items, point) {
        close();
        anchor = target;
        previousExpanded = target.getAttribute('aria-expanded');
        target.setAttribute('aria-expanded', 'true');
        menu.classList.toggle('rich-menu', items.some(item => item.description));
        menu.replaceChildren();
        for (const item of items) {
            const button = document.createElement('button');
            button.textContent = item.label;
            button.setAttribute('role', typeof item.checked === 'boolean' ? 'menuitemradio' : 'menuitem');
            if (typeof item.checked === 'boolean') button.setAttribute('aria-checked', String(item.checked));
            if (item.description) { const detail = document.createElement('small'); detail.textContent = item.description; button.append(detail); }
            button.disabled = Boolean(item.disabled);
            button.tabIndex = -1;
            button.onclick = () => { close(true); item.run(); };
            menu.append(button);
        }
        menu.classList.remove('hidden');
        const rect = target.getBoundingClientRect();
        const x = point?.x ?? rect.left, y = point?.y ?? rect.bottom;
        menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
        menu.querySelector('button:not(:disabled)')?.focus();
    }
    function bind(target, items) {
        target.setAttribute('aria-haspopup', 'menu');
        const open = event => {
            event.preventDefault(); event.stopPropagation();
            show(target, items(), event.type === 'contextmenu' && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : undefined);
        };
        target.addEventListener('contextmenu', open);
        target.addEventListener('keydown', event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
        });
    }
    menu.addEventListener('keydown', event => {
        const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === 'Tab') close(true);
    });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !anchor?.contains(event.target)) close(); });
    document.addEventListener('focusin', event => { if (!menu.contains(event.target) && !anchor?.contains(event.target)) close(); });
    document.addEventListener('scroll', event => { if (!menu.contains(event.target)) close(); }, true);
    window.addEventListener('resize', () => close());
    window.addEventListener('blur', () => close());
    window.mydexMenus = { show, close, bind, isOpen: target => anchor === target && !menu.classList.contains('hidden') };
}());
