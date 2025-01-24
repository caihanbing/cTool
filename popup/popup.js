// DOM 加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 获取关键元素
    const parseBtn = document.getElementById('parse-btn');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const requestSection = document.getElementById('request-section');
    const responseSection = document.getElementById('response-section');

    // 缓存需要清空的元素
    const clearableElements = {
        curlInput: document.getElementById('curl-input'),
        urlEditor: document.getElementById('request-url-editor'),
        payloadEditor: document.getElementById('request-payload-editor'),
        requestHeaders: document.getElementById('request-headers-table').querySelector('tbody'),
        responseHeaders: document.getElementById('response-headers-table').querySelector('tbody'),
        dataOutput: document.getElementById('data-output')
    };

    // Parse 按钮点击事件
    parseBtn.addEventListener('click', () => {
        requestSection.classList.add('active');
        // 这里可以添加解析 CURL 的逻辑
    });

    // Send 按钮点击事件
    sendBtn.addEventListener('click', () => {
        responseSection.classList.add('active');
        // 这里可以添加发送请求的逻辑
    });

    // Clear 按钮点击事件
    clearBtn.addEventListener('click', () => {
        // 清空所有输入和显示内容
        Object.values(clearableElements).forEach(el => {
            if (el.tagName === 'TEXTAREA') {
                el.value = '';
            } else if (el.tagName === 'TBODY') {
                el.innerHTML = `<tr class="empty-row"><td colspan="2">No headers found</td></tr>`;
            } else {
                el.textContent = '';
            }
        });

        // 隐藏区块
        requestSection.classList.remove('active');
        responseSection.classList.remove('active');
    });
});
