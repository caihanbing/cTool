chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'EXECUTE_CURL') {
        const { url, options } = parseCurlCommand(request.command);

        fetch(url, options)
            .then(response => response.text())
            .then(data => sendResponse({ data }))
            .catch(error => sendResponse({ error: error.message }));

        return true; // 保持异步通信
    }
});

// 简易curl解析器
function parseCurlCommand(curl) {
    const methodMatch = curl.match(/-X (\w+)/);
    const urlMatch = curl.match(/'([^']+)'|"([^"]+)"/);
    const headers = {};

    // 解析headers
    curl.match(/-H '([^']+)'/g)?.forEach(h => {
        const [key, value] = h.slice(3, -1).split(/:\s*/);
        headers[key] = value;
    });

    // 解析请求体
    const bodyMatch = curl.match(/--data (-d)?('([^']*)'|"([^"]*)")/);

    return {
        url: urlMatch[1] || urlMatch[2],
        options: {
            method: methodMatch ? methodMatch[1] : 'GET',
            headers: headers,
            body: bodyMatch ? (bodyMatch[3] || bodyMatch[4]) : undefined
        }
    };
}