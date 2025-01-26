document.addEventListener('DOMContentLoaded', () => {
    const historyBody = document.getElementById('history-body');
    const history = JSON.parse(localStorage.getItem('curlHistory')) || [];

    function renderHistory() {
        historyBody.innerHTML = history.length > 0
            ? history.map(entry => `
            <tr>
              <td>${entry.time}</td>
              <td>${entry.data.url}</td>
              <td>${entry.succeed}</td>
              <td>
                <button class="action-button" data-command="${encodeURIComponent(entry.command)}">
                  Apply
                </button>
              </td>
            </tr>
          `).join('')
            : '<tr class="empty-row"><td colspan="4">No history records</td></tr>';

        // 添加按钮点击事件
        document.querySelectorAll('.action-button').forEach(button => {
            button.addEventListener('click', () => {
                const command = decodeURIComponent(button.dataset.command);
                if (window.opener && !window.opener.closed) {
                    window.opener.postMessage({
                        type: 'APPLY_COMMAND',
                        command
                    }, '*');
                    window.close();
                }
            });
        });
    }

    renderHistory();
});