const fs = require('fs');

function parseCurlCommand(curlCommand) {
    const result = {
        url: '',
        method: 'GET',
        headers: {},
        parameters: {},
        payload: null
    };

    // Match the URL
    const urlMatch = curlCommand.match(/curl\s+'([^']+)'/);
    if (urlMatch) {
        // Full URL from the curl command
        const fullUrl = urlMatch[1];

        // Extract the base URL (up to '?')
        const baseUrl = fullUrl.split('?')[0];
        result.url = baseUrl;

        // Extract query parameters from the URL
        const url = new URL(fullUrl);
        url.searchParams.forEach((value, key) => {
            result.parameters[key] = value;
        });
    }

    // Match the headers
    const headerRegex = /-H\s+'([^:]+):\s?([^']+)'/g;
    let headerMatch;
    while ((headerMatch = headerRegex.exec(curlCommand)) !== null) {
        const [_, headerKey, headerValue] = headerMatch;
        result.headers[headerKey.trim()] = headerValue.trim();
    }

    // Match the payload (for POST/PUT requests)
    const dataMatch = curlCommand.match(/--data-raw\s+'([^']+)'/);
    if (dataMatch) {
        result.payload = JSON.parse(dataMatch[1]);
        result.method = 'POST';
    }

    // Adjust method if --data-raw or payload is not present
    if (!dataMatch && curlCommand.includes('--data')) {
        result.method = 'POST';
    }

    return result;
}

const data = fs.readFileSync('test.txt', 'utf-8');
console.log('文件内容:', data);
const result = parseCurlCommand(data)
console.log('解析内容:', result);
