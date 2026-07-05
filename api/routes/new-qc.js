/**
 * new-qc API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /new-qc と /api/new-qc
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');

const router = express.Router();

router.get('/projects', async (req, res) => {
    try {
        const { tool_type } = req.query;

        let query = 'SELECT * FROM qc_analysis_projects';
        const params = [];

        if (tool_type) {
            query += ' WHERE tool_type = $1';
            params.push(tool_type);
        }

        query += ' ORDER BY updated_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching QC projects:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト詳細取得
router.get('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'SELECT * FROM qc_analysis_projects WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト作成
router.post('/projects', async (req, res) => {
    try {
        const schema = Joi.object({
            project_name: Joi.string().required().max(200),
            tool_type: Joi.string().required().valid(
                'affinity', 'relation', 'tree', 'matrix',
                'matrix_data', 'arrow', 'pdpc'
            ),
            description: Joi.string().allow('', null),
            created_by: Joi.string().max(100),
            is_template: Joi.boolean(),
            project_data: Joi.object()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const result = await pool.query(
            `INSERT INTO qc_analysis_projects
            (project_name, tool_type, description, created_by, is_template, project_data)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                value.project_name,
                value.tool_type,
                value.description || null,
                value.created_by || null,
                value.is_template || false,
                JSON.stringify(value.project_data || {})
            ]
        );

        logger.info(`New QC project created: ${result.rows[0].id}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト更新
router.put('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { project_name, description, project_data } = req.body;

        const result = await pool.query(
            `UPDATE qc_analysis_projects
            SET project_name = COALESCE($1, project_name),
                description = COALESCE($2, description),
                project_data = COALESCE($3, project_data),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *`,
            [project_name, description, project_data ? JSON.stringify(project_data) : null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト削除
router.delete('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_analysis_projects WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        logger.info(`QC project deleted: ${id}`);
        res.json({ message: 'Project deleted successfully', id: result.rows[0].id });
    } catch (error) {
        logger.error('Error deleting QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 親和図法（KJ法）---

// カード一覧取得
router.get('/affinity/:projectId/cards', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            `SELECT * FROM qc_affinity_cards
            WHERE project_id = $1
            ORDER BY group_name, position_y, position_x`,
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching affinity cards:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// カード追加
router.post('/affinity/:projectId/cards', async (req, res) => {
    try {
        const { projectId } = req.params;
        const schema = Joi.object({
            card_text: Joi.string().required(),
            group_name: Joi.string().allow('', null).max(200),
            position_x: Joi.number().integer().default(0),
            position_y: Joi.number().integer().default(0),
            color: Joi.string().max(20).default('#fff3cd')
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const result = await pool.query(
            `INSERT INTO qc_affinity_cards
            (project_id, card_text, group_name, position_x, position_y, color)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                projectId,
                value.card_text,
                value.group_name || null,
                value.position_x,
                value.position_y,
                value.color
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating affinity card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// カード更新
router.put('/affinity/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { card_text, group_name, position_x, position_y, color } = req.body;

        const result = await pool.query(
            `UPDATE qc_affinity_cards
            SET card_text = COALESCE($1, card_text),
                group_name = COALESCE($2, group_name),
                position_x = COALESCE($3, position_x),
                position_y = COALESCE($4, position_y),
                color = COALESCE($5, color),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *`,
            [card_text, group_name, position_x, position_y, color, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating affinity card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// カード削除
router.delete('/affinity/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_affinity_cards WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }

        res.json({ message: 'Card deleted successfully' });
    } catch (error) {
        logger.error('Error deleting affinity card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 連関図法 ---

// ノード一覧取得
router.get('/relation/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            'SELECT * FROM qc_relation_nodes WHERE project_id = $1 ORDER BY created_at',
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching relation nodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ノード追加
router.post('/relation/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { node_text, node_type, position_x, position_y, color } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_relation_nodes
            (project_id, node_text, node_type, position_x, position_y, color)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                projectId,
                node_text,
                node_type || 'factor',
                position_x || 0,
                position_y || 0,
                color || '#d1ecf1'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating relation node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エッジ一覧取得
router.get('/relation/:projectId/edges', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            'SELECT * FROM qc_relation_edges WHERE project_id = $1 ORDER BY created_at',
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching relation edges:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エッジ追加
router.post('/relation/:projectId/edges', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { from_node_id, to_node_id, edge_label, strength } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_relation_edges
            (project_id, from_node_id, to_node_id, edge_label, strength)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [
                projectId,
                from_node_id,
                to_node_id,
                edge_label || null,
                strength || 'medium'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating relation edge:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ノード削除
router.delete('/relation/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_relation_nodes WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting relation node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エッジ削除
router.delete('/relation/edges/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_relation_edges WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Edge not found' });
        }

        res.json({ message: 'Edge deleted successfully' });
    } catch (error) {
        logger.error('Error deleting relation edge:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 系統図法（ツリー図）---

// ツリーノード一覧取得
router.get('/tree/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            `SELECT * FROM qc_tree_nodes
            WHERE project_id = $1
            ORDER BY node_level, node_order`,
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching tree nodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ツリーノード追加
router.post('/tree/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { parent_node_id, node_text, node_level, node_order, node_type } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_tree_nodes
            (project_id, parent_node_id, node_text, node_level, node_order, node_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                projectId,
                parent_node_id || null,
                node_text,
                node_level || 0,
                node_order || 0,
                node_type || 'objective'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating tree node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ツリーノード更新
router.put('/tree/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { node_text, node_order } = req.body;

        const result = await pool.query(
            `UPDATE qc_tree_nodes
            SET node_text = COALESCE($1, node_text),
                node_order = COALESCE($2, node_order),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *`,
            [node_text, node_order, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating tree node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ツリーノード削除
router.delete('/tree/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_tree_nodes WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting tree node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- マトリックス図法 ---

// マトリックスデータ取得（項目とセル）
router.get('/matrix/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        const itemsResult = await pool.query(
            `SELECT * FROM qc_matrix_items
            WHERE project_id = $1
            ORDER BY item_type, item_order`,
            [projectId]
        );

        const cellsResult = await pool.query(
            `SELECT * FROM qc_matrix_cells WHERE project_id = $1`,
            [projectId]
        );

        res.json({
            items: itemsResult.rows,
            cells: cellsResult.rows
        });
    } catch (error) {
        logger.error('Error fetching matrix data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// マトリックス項目追加
router.post('/matrix/:projectId/items', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { item_text, item_type, item_order } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_matrix_items
            (project_id, item_text, item_type, item_order)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [projectId, item_text, item_type, item_order || 0]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating matrix item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// マトリックスセル更新
router.put('/matrix/cells', async (req, res) => {
    try {
        const { project_id, row_item_id, column_item_id, relationship_strength, relationship_value, note } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_matrix_cells
            (project_id, row_item_id, column_item_id, relationship_strength, relationship_value, note)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (row_item_id, column_item_id)
            DO UPDATE SET
                relationship_strength = EXCLUDED.relationship_strength,
                relationship_value = EXCLUDED.relationship_value,
                note = EXCLUDED.note,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [project_id, row_item_id, column_item_id, relationship_strength, relationship_value, note]
        );

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating matrix cell:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// マトリックス項目削除
router.delete('/matrix/items/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_matrix_items WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }

        res.json({ message: 'Item deleted successfully' });
    } catch (error) {
        logger.error('Error deleting matrix item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- アローダイアグラム（PERT図）---

// PERT図データ取得
router.get('/arrow/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        const tasksResult = await pool.query(
            'SELECT * FROM qc_arrow_tasks WHERE project_id = $1 ORDER BY id',
            [projectId]
        );

        const depsResult = await pool.query(
            'SELECT * FROM qc_arrow_dependencies WHERE project_id = $1',
            [projectId]
        );

        res.json({
            tasks: tasksResult.rows,
            dependencies: depsResult.rows
        });
    } catch (error) {
        logger.error('Error fetching arrow diagram:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// タスク追加
router.post('/arrow/:projectId/tasks', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { task_name, task_duration, position_x, position_y } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_arrow_tasks
            (project_id, task_name, task_duration, position_x, position_y)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [projectId, task_name, task_duration || 0, position_x || 0, position_y || 0]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating arrow task:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 依存関係追加
router.post('/arrow/:projectId/dependencies', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { predecessor_task_id, successor_task_id, dependency_type } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_arrow_dependencies
            (project_id, predecessor_task_id, successor_task_id, dependency_type)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [projectId, predecessor_task_id, successor_task_id, dependency_type || 'FS']
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating arrow dependency:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// クリティカルパス計算
router.post('/arrow/:projectId/calculate', async (req, res) => {
    try {
        const { projectId } = req.params;

        // タスクと依存関係を取得
        const tasksResult = await pool.query(
            'SELECT * FROM qc_arrow_tasks WHERE project_id = $1',
            [projectId]
        );

        const depsResult = await pool.query(
            'SELECT * FROM qc_arrow_dependencies WHERE project_id = $1',
            [projectId]
        );

        const tasks = tasksResult.rows;
        const dependencies = depsResult.rows;

        // クリティカルパス計算ロジック（簡易版）
        const taskMap = new Map(tasks.map(t => [t.id, {
            ...t,
            earliest_start: 0,
            latest_start: 0,
            slack_time: 0,
            is_critical: false
        }]));

        // 前向き計算（最早開始時刻）
        tasks.forEach(task => {
            const predecessors = dependencies.filter(d => d.successor_task_id === task.id);
            let maxFinish = 0;

            predecessors.forEach(dep => {
                const pred = taskMap.get(dep.predecessor_task_id);
                const finish = pred.earliest_start + parseFloat(pred.task_duration);
                maxFinish = Math.max(maxFinish, finish);
            });

            taskMap.get(task.id).earliest_start = maxFinish;
        });

        // プロジェクト完了時刻
        const projectFinish = Math.max(...Array.from(taskMap.values()).map(
            t => t.earliest_start + parseFloat(t.task_duration)
        ));

        // 後ろ向き計算（最遅開始時刻）
        taskMap.forEach(task => {
            const successors = dependencies.filter(d => d.predecessor_task_id === task.id);

            if (successors.length === 0) {
                task.latest_start = projectFinish - parseFloat(task.task_duration);
            } else {
                let minSuccessorStart = Infinity;
                successors.forEach(dep => {
                    const succ = taskMap.get(dep.successor_task_id);
                    minSuccessorStart = Math.min(minSuccessorStart, succ.latest_start);
                });
                task.latest_start = minSuccessorStart - parseFloat(task.task_duration);
            }

            task.slack_time = task.latest_start - task.earliest_start;
            task.is_critical = task.slack_time === 0;
        });

        // データベース更新
        for (const task of taskMap.values()) {
            await pool.query(
                `UPDATE qc_arrow_tasks
                SET earliest_start = $1, latest_start = $2, slack_time = $3, is_critical = $4
                WHERE id = $5`,
                [task.earliest_start, task.latest_start, task.slack_time, task.is_critical, task.id]
            );
        }

        res.json({
            project_duration: projectFinish,
            critical_path: Array.from(taskMap.values()).filter(t => t.is_critical),
            tasks: Array.from(taskMap.values())
        });
    } catch (error) {
        logger.error('Error calculating critical path:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- PDPC法 ---

// PDPCノード一覧取得
router.get('/pdpc/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            `SELECT * FROM qc_pdpc_nodes
            WHERE project_id = $1
            ORDER BY node_level, id`,
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching PDPC nodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PDPCノード追加
router.post('/pdpc/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;
        const {
            parent_node_id, node_text, node_type, node_level,
            probability, impact_level, position_x, position_y
        } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_pdpc_nodes
            (project_id, parent_node_id, node_text, node_type, node_level,
             probability, impact_level, position_x, position_y)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                projectId,
                parent_node_id || null,
                node_text,
                node_type || 'process',
                node_level || 0,
                probability || null,
                impact_level || null,
                position_x || 0,
                position_y || 0
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating PDPC node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PDPCノード更新
router.put('/pdpc/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { node_text, probability, impact_level, position_x, position_y } = req.body;

        const result = await pool.query(
            `UPDATE qc_pdpc_nodes
            SET node_text = COALESCE($1, node_text),
                probability = COALESCE($2, probability),
                impact_level = COALESCE($3, impact_level),
                position_x = COALESCE($4, position_x),
                position_y = COALESCE($5, position_y),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *`,
            [node_text, probability, impact_level, position_x, position_y, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating PDPC node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PDPCノード削除
router.delete('/pdpc/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_pdpc_nodes WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting PDPC node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==============================================
// モニタリング・分析 API
// ==============================================

// --- リアルタイム出荷モニタリング ---

// 本日の出荷状況サマリー
// モニタリング API はルーターへ分離(routes/monitoring.js)

module.exports = router;
