import mysql from 'mysql2/promise';
import { Octokit } from '@octokit/rest';
import { readFile } from 'fs/promises';
import axios from 'axios';

// 添加云文档同步功能
async function syncToAirDocs(id, newStatus, retryCount = 3) {
    const url = process.env.AIRDOCS_URL;
    const token = process.env.AIRDOCS_TOKEN;

    if (!url || !token) {
        return {
            success: false,
            message: '云文档配置缺失'
        };
    }

    const headers = {
        'AirScript-Token': token,
        'Content-Type': 'application/json'
    };

    const data = {
        Context: {
            argv: {
                id: id,
                status: newStatus
            }
        }
    };

    for (let i = 0; i < retryCount; i++) {
        try {
            const response = await axios.post(url, data, { headers });
            if (response.status === 200) {
                return {
                    success: true,
                    message: '云文档同步成功'
                };
            }
            return {
                success: false,
                message: `云文档同步响应异常: ${response.status}`
            };
        } catch (error) {
            if (i === retryCount - 1) {
                return {
                    success: false,
                    message: `云文档同步失败: ${error.message}`
                };
            }
            // 延迟重试
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    
    // 添加默认返回
    return {
        success: false,
        message: '云文档同步超时'
    };
}


// 解析Issue内容
function parseIssueBody(body) {
    try {
        return JSON.parse(body);
    } catch (error) {
        throw new Error('Invalid operation format');
    }
}

// 获取文件内容
async function getFileContent(octokit, path) {
    try {
        const response = await octokit.repos.getContent({
            owner: 'Echony',
            repo: 'echony-data-storage',
            path: path,
            ref: 'main'
        });
        return {
            content: Buffer.from(response.data.content, 'base64').toString(),
            sha: response.data.sha
        };
    } catch (error) {
        if (error.status === 404) return null;
        throw error;
    }
}

// 更新GitHub文件
async function updateGitHubFile(octokit, path, content, message, sha = null) {
    const params = {
        owner: 'Echony',
        repo: 'echony-data-storage',
        path,
        message,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
        branch: 'main'
    };
    if (sha) params.sha = sha;

    await octokit.repos.createOrUpdateFileContents(params);
}

// 更新索引文件
async function updateIndexFile(octokit, deleteId = null, updateStatus = null) {
    const indexFile = await getFileContent(octokit, 'data/index.json');
    if (!indexFile) throw new Error('Index file not found');

    const indexData = JSON.parse(indexFile.content);

    if (deleteId) {
        indexData.materials = indexData.materials.filter(m => m.id !== deleteId);
    } else if (updateStatus) {
        const material = indexData.materials.find(m => m.id === updateStatus.id);
        if (material) material.current_status = updateStatus.newStatus;
    }

    indexData.last_updated = new Date().toISOString();

    await updateGitHubFile(
        octokit,
        'data/index.json',
        indexData,
        `Update index file`,
        indexFile.sha
    );
}

// 处理删除操作
async function handleDelete(connection, octokit, id) {
    // 1. 删除数据库记录
    await connection.execute('DELETE FROM material_data WHERE id = ?', [id]);
    await connection.execute('DELETE FROM material_info WHERE id = ?', [id]);

    // 2. 删除GitHub文件
    try {
        const file = await getFileContent(octokit, `data/ids/${id}.json`);
        if (file) {
            await octokit.repos.deleteFile({
                owner: 'Echony',
                repo: 'echony-data-storage',
                path: `data/ids/${id}.json`,
                message: `Delete material ${id}`,
                sha: file.sha,
                branch: 'main'
            });
        }
    } catch (error) {
        console.error('Error deleting GitHub file:', error);
    }

    // 3. 更新索引文件
    await updateIndexFile(octokit, id);
}

// 处理状态更新操作
async function handleStatusUpdate(connection, octokit, id, newStatus, issueNumber) {
    let syncResult = null;
    try {
        // 开始数据库事务
        await connection.beginTransaction();

        // 1. 更新数据库
        await connection.execute(
            'UPDATE material_info SET current_status = ? WHERE id = ?',
            [newStatus, id]
        );

        // 2. 更新GitHub文件
        const filePath = `data/ids/${id}.json`;
        const file = await getFileContent(octokit, filePath);
        if (file) {
            const data = JSON.parse(file.content);
            data.current_status = newStatus;
            await updateGitHubFile(
                octokit,
                filePath,
                data,
                `Update status for material ${id}`,
                file.sha
            );
        }

        // 3. 更新索引文件
        await updateIndexFile(octokit, null, { id, newStatus });

        // 4. 同步到云文档
        syncResult = await syncToAirDocs(id, newStatus);

        // 提交数据库事务
        await connection.commit();

        // 5. 记录操作结果
        if (issueNumber) {  // 添加判断
            const resultMessage = syncResult.success 
                ? '✅ 状态更新成功，包括云文档同步'
                : `⚠️ 状态更新成功，但云文档同步失败: ${syncResult.message}`;

            await octokit.issues.createComment({
                owner: 'Echony',
                repo: 'echony-data-storage',
                issue_number: issueNumber,
                body: resultMessage
            });
        }

    } catch (error) {
        // 回滚数据库事务
        await connection.rollback();
        throw error;
    }

    // 如果云文档同步失败，添加一个新的Issue用于追踪
    if (syncResult && !syncResult.success) {
        await octokit.issues.create({
            owner: 'Echony',
            repo: 'echony-data-storage',
            title: `[SYNC_FAILED] Material ${id} status sync failed`,
            body: `
状态更新操作已完成，但云文档同步失败：
- 素材ID: ${id}
- 目标状态: ${newStatus}
- 错误信息: ${syncResult.message}

请手动检查并同步云文档状态。
            `,
            labels: ['sync-failed']
        });
    }
}
// 主函数
async function main() {
    let issueNumber = null;
    
    if (process.env.GITHUB_EVENT_PATH) {
        const eventData = JSON.parse(
            await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')
        );
        issueNumber = eventData.issue.number;
    }

    if (!issueNumber) {
        console.error('No issue number found');
        process.exit(1);
    }

    const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN
    });

    try {
        // 获取Issue内容
        const { data: issue } = await octokit.issues.get({
            owner: 'Echony',
            repo: 'echony-data-storage',
            issue_number: issueNumber
        });

        const operation = parseIssueBody(issue.body);

        // 创建数据库连接
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        try {
            await connection.beginTransaction();

            switch (operation.type) {
                case 'delete':
                    await handleDelete(connection, octokit, operation.id);
                    break;
                case 'updateStatus':
                    // 修改这里，传入 issueNumber
                    await handleStatusUpdate(connection, octokit, operation.id, operation.newStatus, issueNumber);
                    break;
                default:
                    throw new Error('Unknown operation type');
            }

            await connection.commit();

            // 添加成功评论并关闭Issue
            await octokit.issues.createComment({
                owner: 'Echony',
                repo: 'echony-data-storage',
                issue_number: issueNumber,
                body: '✅ Operation completed successfully'
            });

            await octokit.issues.update({
                owner: 'Echony',
                repo: 'echony-data-storage',
                issue_number: issueNumber,
                state: 'closed'
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            await connection.end();
        }

    } catch (error) {
        console.error('Operation failed:', error);
        
        // 添加错误评论
        await octokit.issues.createComment({
            owner: 'Echony',
            repo: 'echony-data-storage',
            issue_number: issueNumber,
            body: `❌ Operation failed: ${error.message}`
        });
        
        process.exit(1);
    }
}
