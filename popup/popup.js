let currentRequestData = null;

// 初始化事件监听
document.getElementById('parse-btn').addEventListener('click', parseCurl);
document.getElementById('send-btn').addEventListener('click', sendRequest);

// 解析CURL命令
function parseCurl() {
    const curlCommand = document.getElementById('curl-input').value.trim();
    if (!curlCommand) return;

    try {
        currentRequestData = enhancedParseCurl(curlCommand);
        renderRequestTable(currentRequestData);
    } catch (error) {
        showError("解析失败: " + error.message);
    }
}

// 渲染可编辑表格
function renderRequestData(data) {
    const tbody = document.querySelector('#params-table tbody');
    tbody.innerHTML = '';

    // 显示基础信息
    addTableRow('method', 'Method', data.method);
    addTableRow('url', 'URL', data.url);

    // 显示Headers
    Object.entries(data.headers).forEach(([key, value]) => {
        addTableRow('header', key, value);
    });

    // 显示Body
    if (data.body) {
        addTableRow('body', 'Body', data.body);
    }

    // 添加空白行用于新增参数
    addNewRowSelector();
}

function addTableRow(type, name, value) {
    const row = document.createElement('tr');
    row.dataset.type = type;
    row.dataset.name = name;

    row.innerHTML = `
    <td>${type.toUpperCase()}</td>
    <td><input type="text" value="${name}" ${type === 'method' ? 'readonly' : ''}></td>
    <td><input type="text" value="${value}"></td>
    <td><button class="delete-btn">×</button></td>
  `;

    // 添加事件监听
    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', handleParamChange);
    });

    row.querySelector('.delete-btn').addEventListener('click', () => {
        row.remove();
        updateCurlInput();
    });

    tbody.appendChild(row);
}

// 参数变更处理
function handleParamChange() {
    const row = this.closest('tr');
    const [type, name] = [row.dataset.type, row.dataset.name];
    const newName = row.querySelector('td:nth-child(2) input').value;
    const newValue = row.querySelector('td:nth-child(3) input').value;

    // 更新数据存储
    if (type === 'header') {
        delete currentRequestData.headers[name];
        currentRequestData.headers[newName] = newValue;
    } else if (type === 'body') {
        currentRequestData.body = newValue;
    }

    updateCurlInput();
}

// 更新原始CURL输入框
function updateCurlInput() {
    const curl = buildCurlFromData(currentRequestData);
    document.getElementById('curl-input').value = curl;
}

// 增强的CURL解析器
function enhancedParseCurl(curl) {
    // 实现细节与之前类似，但返回更结构化的数据
    return {
        method: 'GET',
        url: 'http://example.com',
        headers: {},
        body: null
    };
}

// 根据编辑后的数据生成新CURL
function buildCurlFromData(data) {
    let curl = `curl -X ${data.method} `;

    // 添加headers
    Object.entries(data.headers).forEach(([key, val]) => {
        curl += `-H '${key}: ${val}' `;
    });

    // 添加body
    if (data.body) {
        curl += `--data '${data.body.replace(/'/g, "\\'")}' `;
    }

    curl += `'${data.url}'`;
    return curl;
}

// 添加参数类型选择器
function addNewRowSelector() {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="4">
        <select id="add-param-type">
          <option value="">添加新参数...</option>
          <option value="header">Header</option>
          <option value="query">Query Param</option>
          <option value="body">Body Param</option>
        </select>
      </td>
    `;

    row.querySelector('select').addEventListener('change', function () {
        if (this.value) {
            addTableRow(this.value, 'new-param', 'value');
            this.value = '';
            updateCurlInput();
        }
    });

    tbody.appendChild(row);
}

// 添加自动补全功能
const URL_INPUT = document.querySelector('input[data-type="url"]');
new Awesomplete(URL_INPUT, {
    list: ['http://api.example.com/v1/', 'https://jsonplaceholder.typicode.com/']
});

// 自动调整容器高度
function adjustHeight() {
    const container = document.querySelector('.container');
    const viewportHeight = window.innerHeight;

    // 计算实际内容高度
    const contentHeight = container.scrollHeight;

    // 设置动态高度（不超过视口的 90%）
    container.style.height = Math.min(contentHeight, viewportHeight * 0.9) + 'px';
}

// 初始化时执行
window.addEventListener('DOMContentLoaded', adjustHeight);

// 内容变化时重新调整
new MutationObserver(adjustHeight).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
});

// 窗口大小变化时调整
window.addEventListener('resize', adjustHeight);