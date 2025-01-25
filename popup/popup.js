// DOM 加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 获取关键元素
    const curlInput = document.getElementById('curl-input');
    const sendBtn = document.getElementById('send-btn');
    const parseBtn = document.getElementById('parse-btn');
    const clearBtn = document.getElementById('clear-btn');

    const requestSection = document.getElementById('request-section');
    const method = document.getElementById('request-method');
    const urlEditor = document.getElementById('request-url-editor');
    const parametersTable = document.getElementById('request-parameters-table').querySelector('tbody');
    const headersTable = document.getElementById('request-headers-table').querySelector('tbody');
    const payloadEditor = document.getElementById('request-payload-editor');

    const responseSection = document.getElementById('response-section');

    // 缓存需要清空的元素
    const clearableElements = {
        curlInput: document.getElementById('curl-input'),

        urlEditor: document.getElementById('request-url-editor'),
        requestParameters: document.getElementById('request-parameters-table').querySelector('tbody'),
        requestHeaders: document.getElementById('request-headers-table').querySelector('tbody'),
        payloadEditor: document.getElementById('request-payload-editor'),

        responseHeaders: document.getElementById('response-headers-table').querySelector('tbody'),
        dataOutput: document.getElementById('data-output')
    };

    // Send 按钮点击事件
    sendBtn.addEventListener('click', async () => {
        try {
            // 获取并解析 curl 命令
            const curlCommand = curlInput.value.trim();
            const parsedData = parseCurlCommand(curlCommand);

            if (!parsedData.url) {
                alert("curl command invalid!");
                return;
            }

            // 构建 Fetch 请求参数
            const fetchOptions = {
                method: parsedData.method,
                headers: parsedData.headers,
                body: parsedData.payload ? JSON.stringify(parsedData.payload) : null,
            };

            // 发送 HTTP 请求
            const response = await fetch(parsedData.url, fetchOptions);

            // 检查响应状态
            if (!response.ok) {
                throw new Error(`HTTP request faliure: ${response.status} ${response.statusText}`);
            }

            // 解析响应 Headers 和 Body
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            const responseBody = await response.json(); // 假设返回 JSON 数据

            // 填充响应 Data
            const dataOutput = document.getElementById('data-output');
            dataOutput.textContent = JSON.stringify(responseBody, null, 2);

            // 填充响应 Headers
            const responseHeadersTable = document.getElementById('response-headers-table').querySelector('tbody');
            responseHeadersTable.innerHTML = '';
            if (Object.keys(responseHeaders).length > 0) {
                Object.entries(responseHeaders).forEach(([key, value]) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `<td>${key}</td><td>${value}</td>`;
                    responseHeadersTable.appendChild(row);
                });
            } else {
                responseHeadersTable.innerHTML = '<tr class="empty-row"><td colspan="2">No headers found</td></tr>';
            }

            // 启用下载按钮
            const downloadBtn = document.getElementById('download-btn');
            downloadBtn.disabled = false;
            downloadBtn.addEventListener('click', () => {
                // 获取当前时间并格式化为文件名
                const now = new Date();
                const utcOffset = 8 * 60 * 60 * 1000; // 东八区偏移时间（毫秒）
                const localTime = new Date(now.getTime() + utcOffset);

                // 格式化时间为 YYYY-MM-DD HH-MM-SS
                const formattedTime = localTime
                    .toISOString()
                    .replace('T', ' ')
                    .replace(/:/g, '-')
                    .split('.')[0];
                const fileName = `${formattedTime}.json`;

                // 创建 Blob 并下载
                const blob = new Blob([JSON.stringify(responseBody, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName; // 动态文件名
                a.click();
                URL.revokeObjectURL(url);
            });

            // 更新 UI
            responseSection.classList.add('active');
        } catch (error) {
            console.error('发送请求失败:', error);
            alert(`请求错误: ${error.message}`);
        }
    });

    // Parse 按钮点击事件
    parseBtn.addEventListener('click', () => {
        try {
            const curlCommand = curlInput.value.trim();
            const parsedData = parseCurlCommand(curlCommand);

            // 填充 URL
            urlEditor.value = parsedData.url || '';

            // 填充 method 标记
            method.textContent = `${parsedData.method}`;

            // 填充 Parameters
            parametersTable.innerHTML = ''; // 清空现有内容
            if (parsedData.parameters && Object.keys(parsedData.parameters).length > 0) {
                Object.entries(parsedData.parameters).forEach(([key, value]) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `<td>${key}</td><td>${value}</td>`;
                    parametersTable.appendChild(row);
                });
            } else {
                parametersTable.innerHTML = '<tr class="empty-row"><td colspan="2">No parameters found</td></tr>';
            }

            // 填充 Headers
            headersTable.innerHTML = ''; // 清空现有内容
            if (parsedData.headers && Object.keys(parsedData.headers).length > 0) {
                Object.entries(parsedData.headers).forEach(([name, value]) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `<td>${name}</td><td>${value}</td>`;
                    headersTable.appendChild(row);
                });
            } else {
                headersTable.innerHTML = '<tr class="empty-row"><td colspan="2">No headers found</td></tr>';
            }

            // 填充 Payload
            payloadEditor.value = parsedData.payload ? JSON.stringify(parsedData.payload, null, 2) : '';

            // 显示请求区域
            requestSection.classList.add('active');
        } catch (error) {
            console.error('解析失败:', error);
            alert(`解析错误: ${error.message}`);
        }
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
