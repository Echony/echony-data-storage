import mysql from 'mysql2/promise';
import { Octokit } from '@octokit/rest';
import { readFile } from 'fs/promises';
import axios from 'axios';

// 云文档API配置
const AIRSHEET_API = {
    URL: "https://www.kdocs.cn/api/v3/ide/file/cpXhP1mJW9Em/script/V2-7nuF4pEadCZioB8mpBhP5i/sync_task",
    TOKEN: process.env.AIRSHEET_TOKEN
};

// 更新云文档状态
async function updateAirsheetStatus(id, newStatus) {
    try {
        const response = await axios.post(AIRSHEET_API.URL, {
            Context: {
                argv: {
                    id: id,
                    status: newStatus
                }
            }
        }, {
            headers: {
                'AirScript-Token': AIRSHEET_API.TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (response.status !== 200) {
            throw new Error(`Airsheet API returned status ${response.status}`);
        }

        console.log(`Successfully updated Airsheet status for ID ${id}`);
        return true;
    } catch (error) {
        console.error('Error updating Airsheet status:', error.message);
        throw new Error('Failed to update Airsheet status');
    }
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
async function handleStatusUpdate(connection, octokit, id, newStatus) {
    try {
        console.log(`Starting status update process for ID ${id} to ${newStatus}`);
        
        // 开始事务
        await connection.beginTransaction();
        
        try {
            // 1. 更新数据库
            console.log('Updating database...');
            await connection.execute(
                'UPDATE material_info SET current_status = ? WHERE id = ?',
                [newStatus, id]
            );

            // 2. 更新GitHub文件
            console.log('Updating GitHub file...');
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

            // 3. 更新云文档
            console.log('Updating Airsheet...');
            await updateAirsheetStatus(id, newStatus);

            // 4. 更新索引文件
            console.log('Updating index file...');
            await updateIndexFile(octokit, null, { id, newStatus });

            // 提交事务
            await connection.commit();
            console.log('Status update completed successfully');

        } catch (error) {
            // 如果出现错误，回滚所有更改
            console.error('Error during status update, rolling back:', error);
            await connection.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Status update failed:', error);
        throw error;
    }
}

// 主函数
async function main() {
    let connection;
    try {
        // 获取Issue信息...现有代码保持不变
        
        const operation = parseIssueBody(issue.body);
        
        // 创建数据库连接
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        switch (operation.type) {
            case 'delete':
                await handleDelete(connection, octokit, operation.id);
                break;
            case 'updateStatus':
                await handleStatusUpdate(connection, octokit, operation.id, operation.newStatus);
                break;
            default:
                throw new Error('Unknown operation type');
        }

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
        console.error('Operation failed:', error);
        
        // 添加错误评论
        if (issueNumber) {
            await octokit.issues.createComment({
                owner: 'Echony',
                repo: 'echony-data-storage',
                issue_number: issueNumber,
                body: `❌ Operation failed: ${error.message}`
            });
        }
        
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

main().catch(console.error);
