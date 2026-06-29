// 新QC七つ道具 - JavaScriptロジック
const API_BASE_URL = window.location.protocol + '//' + window.location.host + '/api';

// 現在のプロジェクトID
let currentProjectId = null;
let currentToolType = null;

// Toast表示関数
function showToast(message, type = 'info', duration = 3000) {
    const toastHtml = `
        <div class="toast align-items-center text-white bg-${type === 'success' ? 'success' : type === 'danger' ? 'danger' : 'primary'} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;

    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.position = 'fixed';
        toastContainer.style.top = '20px';
        toastContainer.style.right = '20px';
        toastContainer.style.zIndex = '9999';
        document.body.appendChild(toastContainer);
    }

    const toastElement = document.createElement('div');
    toastElement.innerHTML = toastHtml;
    toastContainer.appendChild(toastElement);

    const toast = new bootstrap.Toast(toastElement.querySelector('.toast'), { delay: duration });
    toast.show();

    toastElement.querySelector('.toast').addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

// プロジェクト作成・読み込みモーダル
function showProjectModal(toolType) {
    currentToolType = toolType;

    const modalHtml = `
        <div class="modal fade" id="projectModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">プロジェクト選択</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">既存プロジェクト</label>
                            <select class="form-select" id="existingProjectSelect">
                                <option value="">プロジェクトを選択...</option>
                            </select>
                        </div>
                        <hr>
                        <div class="mb-3">
                            <label class="form-label">新規プロジェクト名</label>
                            <input type="text" class="form-control" id="newProjectName" placeholder="プロジェクト名を入力">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">説明</label>
                            <textarea class="form-control" id="projectDescription" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
                        <button type="button" class="btn btn-primary" onclick="loadExistingProject()">読み込み</button>
                        <button type="button" class="btn btn-success" onclick="createNewProject()">新規作成</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // モーダルが既に存在する場合は削除
    const existingModal = document.getElementById('projectModal');
    if (existingModal) {
        existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 既存プロジェクト一覧を読み込み
    loadProjectList(toolType);

    const modal = new bootstrap.Modal(document.getElementById('projectModal'));
    modal.show();
}

async function loadProjectList(toolType) {
    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/projects?tool_type=${toolType}`);
        const projects = await response.json();

        const select = document.getElementById('existingProjectSelect');
        select.innerHTML = '<option value="">プロジェクトを選択...</option>';

        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = `${project.project_name} (${new Date(project.updated_at).toLocaleDateString()})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading projects:', error);
        showToast('プロジェクト一覧の読み込みに失敗しました', 'danger');
    }
}

async function createNewProject() {
    const projectName = document.getElementById('newProjectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();

    if (!projectName) {
        showToast('プロジェクト名を入力してください', 'danger');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_name: projectName,
                tool_type: currentToolType,
                description: description,
                created_by: 'ユーザー'
            })
        });

        if (!response.ok) {
            throw new Error('プロジェクト作成に失敗しました');
        }

        const project = await response.json();
        currentProjectId = project.id;

        bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
        showToast('プロジェクトを作成しました', 'success');

        // ツール初期化
        initializeTool(currentToolType);
    } catch (error) {
        console.error('Error creating project:', error);
        showToast('プロジェクト作成に失敗しました: ' + error.message, 'danger');
    }
}

async function loadExistingProject() {
    const projectId = document.getElementById('existingProjectSelect').value;

    if (!projectId) {
        showToast('プロジェクトを選択してください', 'danger');
        return;
    }

    currentProjectId = projectId;
    bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
    showToast('プロジェクトを読み込みました', 'success');

    // ツール初期化
    initializeTool(currentToolType);
}

function initializeTool(toolType) {
    switch (toolType) {
        case 'affinity':
            loadAffinityCards();
            break;
        case 'relation':
            loadRelationDiagram();
            break;
        case 'tree':
            loadTreeDiagram();
            break;
        case 'matrix':
            loadMatrixDiagram();
            break;
        case 'arrow':
            loadArrowDiagram();
            break;
        case 'pdpc':
            loadPDPCDiagram();
            break;
    }
}

// ==============================================
// 親和図法（KJ法）
// ==============================================

let affinityCards = [];
let draggedCard = null;

async function loadAffinityCards() {
    if (!currentProjectId) {
        showProjectModal('affinity');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/affinity/${currentProjectId}/cards`);
        affinityCards = await response.json();
        renderAffinityCards();
    } catch (error) {
        console.error('Error loading affinity cards:', error);
        showToast('カードの読み込みに失敗しました', 'danger');
    }
}

function renderAffinityCards() {
    const canvas = document.querySelector('#affinity-content .canvas-area');
    canvas.innerHTML = '';

    // グループごとに整理
    const groups = {};
    affinityCards.forEach(card => {
        const group = card.group_name || '未分類';
        if (!groups[group]) {
            groups[group] = [];
        }
        groups[group].push(card);
    });

    // グループとカードを描画
    Object.keys(groups).forEach(groupName => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'affinity-group mb-4';
        groupDiv.innerHTML = `
            <h6 class="mb-2">${groupName}</h6>
            <div class="affinity-cards-container d-flex flex-wrap gap-2"></div>
        `;

        const container = groupDiv.querySelector('.affinity-cards-container');

        groups[groupName].forEach(card => {
            const cardElement = document.createElement('div');
            cardElement.className = 'affinity-card';
            cardElement.style.backgroundColor = card.color || '#fff3cd';
            cardElement.style.border = '1px solid #ffc107';
            cardElement.style.borderRadius = '0.5rem';
            cardElement.style.padding = '0.75rem';
            cardElement.style.cursor = 'move';
            cardElement.style.minWidth = '150px';
            cardElement.draggable = true;
            cardElement.dataset.cardId = card.id;

            cardElement.innerHTML = `
                <div>${card.card_text}</div>
                <div class="mt-2">
                    <button class="btn btn-sm btn-outline-primary" onclick="editAffinityCard(${card.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteAffinityCard(${card.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;

            cardElement.addEventListener('dragstart', handleDragStart);
            cardElement.addEventListener('dragend', handleDragEnd);

            container.appendChild(cardElement);
        });

        canvas.appendChild(groupDiv);
    });
}

function handleDragStart(e) {
    draggedCard = this;
    this.style.opacity = '0.4';
}

function handleDragEnd(e) {
    this.style.opacity = '1';
}

async function addAffinityCard() {
    if (!currentProjectId) {
        showProjectModal('affinity');
        return;
    }

    const cardText = prompt('カードのテキストを入力してください:');
    if (!cardText) return;

    const groupName = prompt('グループ名を入力してください（空欄で未分類）:') || '未分類';

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/affinity/${currentProjectId}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                card_text: cardText,
                group_name: groupName,
                position_x: 0,
                position_y: 0,
                color: '#fff3cd'
            })
        });

        if (!response.ok) throw new Error('カード追加に失敗しました');

        showToast('カードを追加しました', 'success');
        loadAffinityCards();
    } catch (error) {
        console.error('Error adding affinity card:', error);
        showToast('カード追加に失敗しました', 'danger');
    }
}

async function editAffinityCard(cardId) {
    const card = affinityCards.find(c => c.id === cardId);
    if (!card) return;

    const newText = prompt('カードのテキスト:', card.card_text);
    if (!newText) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/affinity/cards/${cardId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_text: newText })
        });

        if (!response.ok) throw new Error('カード更新に失敗しました');

        showToast('カードを更新しました', 'success');
        loadAffinityCards();
    } catch (error) {
        console.error('Error updating affinity card:', error);
        showToast('カード更新に失敗しました', 'danger');
    }
}

async function deleteAffinityCard(cardId) {
    if (!confirm('このカードを削除してもよろしいですか？')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/affinity/cards/${cardId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('カード削除に失敗しました');

        showToast('カードを削除しました', 'success');
        loadAffinityCards();
    } catch (error) {
        console.error('Error deleting affinity card:', error);
        showToast('カード削除に失敗しました', 'danger');
    }
}

// ==============================================
// 連関図法
// ==============================================

let relationNodes = [];
let relationEdges = [];

async function loadRelationDiagram() {
    if (!currentProjectId) {
        showProjectModal('relation');
        return;
    }

    try {
        const [nodesRes, edgesRes] = await Promise.all([
            fetch(`${API_BASE_URL}/new-qc/relation/${currentProjectId}/nodes`),
            fetch(`${API_BASE_URL}/new-qc/relation/${currentProjectId}/edges`)
        ]);

        relationNodes = await nodesRes.json();
        relationEdges = await edgesRes.json();

        renderRelationDiagram();
    } catch (error) {
        console.error('Error loading relation diagram:', error);
        showToast('連関図の読み込みに失敗しました', 'danger');
    }
}

function renderRelationDiagram() {
    const canvas = document.querySelector('#relation-content .canvas-area');
    canvas.innerHTML = '<div id="relation-svg-container"></div>';

    const container = document.getElementById('relation-svg-container');
    container.innerHTML = `
        <svg width="100%" height="600" id="relation-svg">
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                    <polygon points="0 0, 10 3, 0 6" fill="#0dcaf0" />
                </marker>
            </defs>
        </svg>
        <div class="mt-3">
            <button class="btn btn-primary" onclick="addRelationNode()">
                <i class="fas fa-plus me-2"></i>ノード追加
            </button>
            <button class="btn btn-success" onclick="addRelationEdge()">
                <i class="fas fa-arrow-right me-2"></i>関係追加
            </button>
        </div>
    `;

    const svg = document.getElementById('relation-svg');

    // エッジ描画
    relationEdges.forEach(edge => {
        const fromNode = relationNodes.find(n => n.id === edge.from_node_id);
        const toNode = relationNodes.find(n => n.id === edge.to_node_id);

        if (fromNode && toNode) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', fromNode.position_x || 100);
            line.setAttribute('y1', fromNode.position_y || 100);
            line.setAttribute('x2', toNode.position_x || 200);
            line.setAttribute('y2', toNode.position_y || 200);
            line.setAttribute('stroke', '#0dcaf0');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            svg.appendChild(line);
        }
    });

    // ノード描画
    relationNodes.forEach(node => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', node.position_x || 100);
        circle.setAttribute('cy', node.position_y || 100);
        circle.setAttribute('r', '40');
        circle.setAttribute('fill', node.color || '#d1ecf1');
        circle.setAttribute('stroke', '#0dcaf0');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', node.position_x || 100);
        text.setAttribute('y', node.position_y || 105);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '12');
        text.textContent = node.node_text.substring(0, 10);
        svg.appendChild(text);
    });
}

async function addRelationNode() {
    if (!currentProjectId) {
        showProjectModal('relation');
        return;
    }

    const nodeText = prompt('ノードのテキストを入力してください:');
    if (!nodeText) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/relation/${currentProjectId}/nodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_text: nodeText,
                node_type: 'factor',
                position_x: 100 + Math.random() * 400,
                position_y: 100 + Math.random() * 300
            })
        });

        if (!response.ok) throw new Error('ノード追加に失敗しました');

        showToast('ノードを追加しました', 'success');
        loadRelationDiagram();
    } catch (error) {
        console.error('Error adding relation node:', error);
        showToast('ノード追加に失敗しました', 'danger');
    }
}

async function addRelationEdge() {
    if (relationNodes.length < 2) {
        showToast('ノードが2つ以上必要です', 'danger');
        return;
    }

    // 簡易的にノード選択
    const fromId = parseInt(prompt(`始点ノードID (${relationNodes.map(n => n.id + ':' + n.node_text).join(', ')}):`));
    const toId = parseInt(prompt(`終点ノードID (${relationNodes.map(n => n.id + ':' + n.node_text).join(', ')}):`));

    if (!fromId || !toId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/relation/${currentProjectId}/edges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_node_id: fromId,
                to_node_id: toId,
                strength: 'medium'
            })
        });

        if (!response.ok) throw new Error('関係追加に失敗しました');

        showToast('関係を追加しました', 'success');
        loadRelationDiagram();
    } catch (error) {
        console.error('Error adding relation edge:', error);
        showToast('関係追加に失敗しました', 'danger');
    }
}

// ==============================================
// 系統図法（ツリー図）
// ==============================================

let treeNodes = [];

async function loadTreeDiagram() {
    if (!currentProjectId) {
        showProjectModal('tree');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/tree/${currentProjectId}/nodes`);
        treeNodes = await response.json();
        renderTreeDiagram();
    } catch (error) {
        console.error('Error loading tree diagram:', error);
        showToast('系統図の読み込みに失敗しました', 'danger');
    }
}

function renderTreeDiagram() {
    const canvas = document.querySelector('#systematic-content .canvas-area');
    canvas.innerHTML = `
        <div id="tree-container"></div>
        <div class="mt-3">
            <button class="btn btn-primary" onclick="addTreeNode(null, 0)">
                <i class="fas fa-plus me-2"></i>ルートノード追加
            </button>
        </div>
    `;

    const container = document.getElementById('tree-container');

    // ルートノード（parent_node_id がnull）から描画
    const rootNodes = treeNodes.filter(n => n.parent_node_id === null);

    function renderNode(node, level = 0) {
        const nodeDiv = document.createElement('div');
        nodeDiv.style.marginLeft = `${level * 30}px`;
        nodeDiv.style.marginBottom = '10px';
        nodeDiv.innerHTML = `
            <div class="tree-node d-inline-block">
                ${node.node_text}
                <button class="btn btn-sm btn-outline-primary ms-2" onclick="addTreeNode(${node.id}, ${level + 1})">
                    <i class="fas fa-plus"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger ms-1" onclick="deleteTreeNode(${node.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        container.appendChild(nodeDiv);

        // 子ノードを再帰的に描画
        const children = treeNodes.filter(n => n.parent_node_id === node.id);
        children.forEach(child => renderNode(child, level + 1));
    }

    rootNodes.forEach(node => renderNode(node));
}

async function addTreeNode(parentNodeId = null, level = 0) {
    if (!currentProjectId) {
        showProjectModal('tree');
        return;
    }

    const nodeText = prompt('ノードのテキストを入力してください:');
    if (!nodeText) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/tree/${currentProjectId}/nodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                parent_node_id: parentNodeId,
                node_text: nodeText,
                node_level: level,
                node_order: 0
            })
        });

        if (!response.ok) throw new Error('ノード追加に失敗しました');

        showToast('ノードを追加しました', 'success');
        loadTreeDiagram();
    } catch (error) {
        console.error('Error adding tree node:', error);
        showToast('ノード追加に失敗しました', 'danger');
    }
}

async function deleteTreeNode(nodeId) {
    if (!confirm('このノード（と子ノード）を削除してもよろしいですか？')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/tree/nodes/${nodeId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('ノード削除に失敗しました');

        showToast('ノードを削除しました', 'success');
        loadTreeDiagram();
    } catch (error) {
        console.error('Error deleting tree node:', error);
        showToast('ノード削除に失敗しました', 'danger');
    }
}

// ==============================================
// マトリックス図法
// ==============================================

let matrixItems = [];
let matrixCells = [];

async function loadMatrixDiagram() {
    if (!currentProjectId) {
        showProjectModal('matrix');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/matrix/${currentProjectId}`);
        const data = await response.json();
        matrixItems = data.items;
        matrixCells = data.cells;
        renderMatrixDiagram();
    } catch (error) {
        console.error('Error loading matrix diagram:', error);
        showToast('マトリックス図の読み込みに失敗しました', 'danger');
    }
}

function renderMatrixDiagram() {
    const canvas = document.querySelector('#matrix-content .canvas-area');

    const rowItems = matrixItems.filter(i => i.item_type === 'row');
    const colItems = matrixItems.filter(i => i.item_type === 'column');

    let tableHtml = `
        <div class="mb-3">
            <button class="btn btn-primary btn-sm" onclick="addMatrixItem('row')">行項目追加</button>
            <button class="btn btn-success btn-sm ms-2" onclick="addMatrixItem('column')">列項目追加</button>
        </div>
        <div class="table-responsive">
            <table class="table table-bordered">
                <thead>
                    <tr>
                        <th></th>
    `;

    colItems.forEach(col => {
        tableHtml += `<th>${col.item_text}</th>`;
    });

    tableHtml += '</tr></thead><tbody>';

    rowItems.forEach(row => {
        tableHtml += `<tr><th>${row.item_text}</th>`;

        colItems.forEach(col => {
            const cell = matrixCells.find(c => c.row_item_id === row.id && c.column_item_id === col.id);
            const strength = cell ? cell.relationship_strength : 'none';
            const bgColor = strength === 'strong' ? '#198754' :
                            strength === 'medium' ? '#ffc107' :
                            strength === 'weak' ? '#f8f9fa' : '#fff';

            tableHtml += `
                <td class="matrix-cell" style="background-color: ${bgColor}; cursor: pointer;"
                    onclick="editMatrixCell(${row.id}, ${col.id})">
                    ${strength !== 'none' ? strength : '-'}
                </td>
            `;
        });

        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table></div>';

    canvas.innerHTML = tableHtml;
}

async function addMatrixItem(itemType) {
    if (!currentProjectId) {
        showProjectModal('matrix');
        return;
    }

    const itemText = prompt(`${itemType === 'row' ? '行' : '列'}項目のテキストを入力してください:`);
    if (!itemText) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/matrix/${currentProjectId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_text: itemText,
                item_type: itemType,
                item_order: matrixItems.filter(i => i.item_type === itemType).length
            })
        });

        if (!response.ok) throw new Error('項目追加に失敗しました');

        showToast('項目を追加しました', 'success');
        loadMatrixDiagram();
    } catch (error) {
        console.error('Error adding matrix item:', error);
        showToast('項目追加に失敗しました', 'danger');
    }
}

async function editMatrixCell(rowItemId, colItemId) {
    const strength = prompt('関係度を入力してください (none/weak/medium/strong):', 'none');
    if (!strength) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/matrix/cells`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: currentProjectId,
                row_item_id: rowItemId,
                column_item_id: colItemId,
                relationship_strength: strength
            })
        });

        if (!response.ok) throw new Error('セル更新に失敗しました');

        showToast('セルを更新しました', 'success');
        loadMatrixDiagram();
    } catch (error) {
        console.error('Error updating matrix cell:', error);
        showToast('セル更新に失敗しました', 'danger');
    }
}

// ==============================================
// アローダイアグラム（PERT図）
// ==============================================

let arrowTasks = [];
let arrowDependencies = [];

async function loadArrowDiagram() {
    if (!currentProjectId) {
        showProjectModal('arrow');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/arrow/${currentProjectId}`);
        const data = await response.json();
        arrowTasks = data.tasks;
        arrowDependencies = data.dependencies;
        renderArrowDiagram();
    } catch (error) {
        console.error('Error loading arrow diagram:', error);
        showToast('PERT図の読み込みに失敗しました', 'danger');
    }
}

function renderArrowDiagram() {
    const canvas = document.querySelector('#arrow-content .canvas-area');

    let html = `
        <div class="mb-3">
            <button class="btn btn-primary" onclick="addArrowTask()">
                <i class="fas fa-plus me-2"></i>タスク追加
            </button>
            <button class="btn btn-success ms-2" onclick="addArrowDependency()">
                <i class="fas fa-link me-2"></i>依存関係追加
            </button>
            <button class="btn btn-warning ms-2" onclick="calculateCriticalPath()">
                <i class="fas fa-calculator me-2"></i>クリティカルパス計算
            </button>
        </div>
        <div class="table-responsive">
            <table class="table table-bordered">
                <thead>
                    <tr>
                        <th>タスク名</th>
                        <th>所要時間</th>
                        <th>最早開始</th>
                        <th>最遅開始</th>
                        <th>余裕時間</th>
                        <th>クリティカル</th>
                    </tr>
                </thead>
                <tbody>
    `;

    arrowTasks.forEach(task => {
        html += `
            <tr class="${task.is_critical ? 'table-danger' : ''}">
                <td>${task.task_name}</td>
                <td>${task.task_duration}</td>
                <td>${task.earliest_start || '-'}</td>
                <td>${task.latest_start || '-'}</td>
                <td>${task.slack_time || '-'}</td>
                <td>${task.is_critical ? '<i class="fas fa-exclamation-triangle text-danger"></i>' : '-'}</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';

    canvas.innerHTML = html;
}

async function addArrowTask() {
    if (!currentProjectId) {
        showProjectModal('arrow');
        return;
    }

    const taskName = prompt('タスク名を入力してください:');
    if (!taskName) return;

    const duration = parseFloat(prompt('所要時間（日数）を入力してください:', '1'));
    if (isNaN(duration)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/arrow/${currentProjectId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task_name: taskName,
                task_duration: duration
            })
        });

        if (!response.ok) throw new Error('タスク追加に失敗しました');

        showToast('タスクを追加しました', 'success');
        loadArrowDiagram();
    } catch (error) {
        console.error('Error adding arrow task:', error);
        showToast('タスク追加に失敗しました', 'danger');
    }
}

async function addArrowDependency() {
    if (arrowTasks.length < 2) {
        showToast('タスクが2つ以上必要です', 'danger');
        return;
    }

    const predId = parseInt(prompt(`先行タスクID (${arrowTasks.map(t => t.id + ':' + t.task_name).join(', ')}):`));
    const succId = parseInt(prompt(`後続タスクID (${arrowTasks.map(t => t.id + ':' + t.task_name).join(', ')}):`));

    if (!predId || !succId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/arrow/${currentProjectId}/dependencies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predecessor_task_id: predId,
                successor_task_id: succId,
                dependency_type: 'FS'
            })
        });

        if (!response.ok) throw new Error('依存関係追加に失敗しました');

        showToast('依存関係を追加しました', 'success');
        loadArrowDiagram();
    } catch (error) {
        console.error('Error adding arrow dependency:', error);
        showToast('依存関係追加に失敗しました', 'danger');
    }
}

async function calculateCriticalPath() {
    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/arrow/${currentProjectId}/calculate`, {
            method: 'POST'
        });

        if (!response.ok) throw new Error('クリティカルパス計算に失敗しました');

        const result = await response.json();
        showToast(`プロジェクト期間: ${result.project_duration}日\nクリティカルパス: ${result.critical_path.length}タスク`, 'success', 5000);

        loadArrowDiagram();
    } catch (error) {
        console.error('Error calculating critical path:', error);
        showToast('クリティカルパス計算に失敗しました', 'danger');
    }
}

// ==============================================
// PDPC法
// ==============================================

let pdpcNodes = [];

async function loadPDPCDiagram() {
    if (!currentProjectId) {
        showProjectModal('pdpc');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/pdpc/${currentProjectId}/nodes`);
        pdpcNodes = await response.json();
        renderPDPCDiagram();
    } catch (error) {
        console.error('Error loading PDPC diagram:', error);
        showToast('PDPC図の読み込みに失敗しました', 'danger');
    }
}

function renderPDPCDiagram() {
    const canvas = document.querySelector('#pdpc-content .canvas-area');
    canvas.innerHTML = `
        <div id="pdpc-container"></div>
        <div class="mt-3">
            <button class="btn btn-primary" onclick="addPDPCNode(null, 0, 'objective')">
                <i class="fas fa-plus me-2"></i>目的ノード追加
            </button>
        </div>
    `;

    const container = document.getElementById('pdpc-container');

    const rootNodes = pdpcNodes.filter(n => n.parent_node_id === null);

    function renderNode(node, level = 0) {
        const typeColors = {
            'objective': '#0d6efd',
            'process': '#198754',
            'problem': '#dc3545',
            'countermeasure': '#ffc107'
        };

        const nodeDiv = document.createElement('div');
        nodeDiv.style.marginLeft = `${level * 30}px`;
        nodeDiv.style.marginBottom = '10px';
        nodeDiv.innerHTML = `
            <div class="pdpc-node d-inline-block p-2" style="border: 2px solid ${typeColors[node.node_type] || '#ccc'}; border-radius: 0.5rem;">
                <strong>[${node.node_type}]</strong> ${node.node_text}
                ${node.probability ? ` (発生確率: ${node.probability}%)` : ''}
                <button class="btn btn-sm btn-outline-success ms-2" onclick="addPDPCNode(${node.id}, ${level + 1}, 'process')">
                    <i class="fas fa-plus"></i>プロセス
                </button>
                <button class="btn btn-sm btn-outline-warning ms-1" onclick="addPDPCNode(${node.id}, ${level + 1}, 'problem')">
                    <i class="fas fa-exclamation-triangle"></i>問題
                </button>
                <button class="btn btn-sm btn-outline-info ms-1" onclick="addPDPCNode(${node.id}, ${level + 1}, 'countermeasure')">
                    <i class="fas fa-shield-alt"></i>対策
                </button>
                <button class="btn btn-sm btn-outline-danger ms-1" onclick="deletePDPCNode(${node.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        container.appendChild(nodeDiv);

        const children = pdpcNodes.filter(n => n.parent_node_id === node.id);
        children.forEach(child => renderNode(child, level + 1));
    }

    rootNodes.forEach(node => renderNode(node));
}

async function addPDPCNode(parentNodeId = null, level = 0, nodeType = 'objective') {
    if (!currentProjectId) {
        showProjectModal('pdpc');
        return;
    }

    const nodeText = prompt('ノードのテキストを入力してください:');
    if (!nodeText) return;

    let probability = null;
    if (nodeType === 'problem') {
        probability = parseFloat(prompt('発生確率（%）を入力してください:', '0'));
    }

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/pdpc/${currentProjectId}/nodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                parent_node_id: parentNodeId,
                node_text: nodeText,
                node_type: nodeType,
                node_level: level,
                probability: probability
            })
        });

        if (!response.ok) throw new Error('ノード追加に失敗しました');

        showToast('ノードを追加しました', 'success');
        loadPDPCDiagram();
    } catch (error) {
        console.error('Error adding PDPC node:', error);
        showToast('ノード追加に失敗しました', 'danger');
    }
}

async function deletePDPCNode(nodeId) {
    if (!confirm('このノード（と子ノード）を削除してもよろしいですか？')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/new-qc/pdpc/nodes/${nodeId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('ノード削除に失敗しました');

        showToast('ノードを削除しました', 'success');
        loadPDPCDiagram();
    } catch (error) {
        console.error('Error deleting PDPC node:', error);
        showToast('ノード削除に失敗しました', 'danger');
    }
}
