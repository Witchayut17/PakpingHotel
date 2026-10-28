'use strict';

window.PakpingPagination = {
    render(container, { pageCount, currentPage, controlsId, onPage, scrollTarget }) {
        container.hidden = pageCount <= 1;
        container.replaceChildren();
        if (pageCount <= 1) return;

        container.classList.add('pagination-bar');
        const status = document.createElement('span');
        status.className = 'pagination-status';
        status.textContent = `หน้า ${currentPage} จาก ${pageCount}`;
        const controls = document.createElement('div');
        controls.className = 'pagination-controls';
        const navigate = (page) => {
            if (!Number.isInteger(page) || page < 1 || page > pageCount || page === currentPage) return;
            onPage(page);
            container.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
            scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        const button = (label, page, className, text, disabled = false) => {
            const node = document.createElement('button');
            node.type = 'button';
            node.className = className;
            node.textContent = text;
            node.setAttribute('aria-label', label);
            node.setAttribute('aria-controls', controlsId);
            node.disabled = disabled;
            node.addEventListener('click', () => navigate(page));
            return node;
        };

        const navigation = document.createElement('div');
        navigation.className = 'pagination-navigation';
        navigation.append(button('หน้าก่อนหน้า', currentPage - 1, 'pagination-step', '‹', currentPage === 1));
        const start = Math.max(1, Math.min(currentPage - 1, pageCount - 3));
        for (let page = start; page <= Math.min(start + 3, pageCount); page++) {
            const node = button(`หน้าที่ ${page}`, page, 'pagination-number', String(page));
            if (page === currentPage) node.setAttribute('aria-current', 'page');
            navigation.append(node);
        }
        navigation.append(button('หน้าถัดไป', currentPage + 1, 'pagination-step', '›', currentPage === pageCount));
        controls.append(navigation);

        const form = document.createElement('form');
        form.className = 'pagination-jump';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = String(pageCount);
        input.step = '1';
        input.required = true;
        input.inputMode = 'numeric';
        input.value = String(currentPage);
        input.setAttribute('aria-label', `ไปหน้าที่ 1 ถึง ${pageCount}`);
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'ไป';
        submit.setAttribute('aria-label', 'ไปยังหน้าที่กรอก');
        form.append(input, submit);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            navigate(Number(input.value));
        });
        controls.append(form);
        const last = button('ไปหน้าสุดท้าย', pageCount, 'pagination-last', '»', currentPage === pageCount);
        last.title = 'ไปหน้าสุดท้าย';
        controls.append(last);
        container.append(status, controls);
    },
};
