import mysql from 'mysql2/promise';
import { Octokit } from '@octokit/rest';
import { readFile } from 'fs/promises';
import fetch from 'node-fetch';

// 重试工具类
class RetryHelper {
    static async withRetry(operation, maxRetries = 3, delay = 1000) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                console.error(`Attempt ${i + 1} failed:`, error);
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                }
            }
        }
        
        throw lastError;
    }
}

// 金山云文档 API 客户端
class AirScriptClient {
    constructor(token, url) {
        this.token = token;
        this.url = url;
    }

    async updateStatus(id, newStatus) {
        return RetryHelper.withRetry(async () => {
            const response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'AirScript-Token': this.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    Context: {
                        argv: {
                            id: id,
                            status: newStatus
                        }
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`AirScript API error: ${errorText}`);
            }

            return await response.json();
        });
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

// GitHub 文件操作类
class GitHubFileManager {
    constructor(octokit) {
        this.octokit = octokit;
    }

    async getFileContent(path) {
        try {
            const response = await this.octokit.repos.getContent({
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

    async updateFile(path, content, message, sha = null) {
        const params = {
            owner: 'Echony',
            repo: 'echony-data-storage',
            path,
            message,
            content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
            branch: 'main'
        };
        if (sha) params.sha = sha;

        await this.octokit.repos.createOrUpdateFileContents(params);
    }

    async deleteFile(path, message, sha) {
        await this.octokit.repos.deleteFile({
            owner: 'Echony',
            repo: 'echony-data-storage',
            path,
            message,
            sha,
            branch: 'main'
        });
    }
}

// 操作处理类
class OperationProcessor {
    constructor(connection, octokit, airScriptClient) {
        this.connection = connection;
        this.gitHubManager = new GitHubFileManager(octokit);
        this.airScriptClient = airScriptClient;
        this.octokit = octokit;
    }

    async updateIndexFile(deleteId = null, updateStatus = null) {
        const indexFile = await this.gitHubManager.getFileContent('data/index.json');
        if (!indexFile) throw new Error('Index file not found');

        const indexData = JSON.parse(indexFile.content);

        if (deleteId) {
            indexData.materials = indexData.materials.filter(m => m.id !== deleteId);
        } else if (updateStatus) {
            const material = indexData.materials.find(m => m.id === updateStatus.id);
            if (material) material.current_status = updateStatus.newStatus;
        }

        indexData.last_updated = new Date().toISOString();

        await this.gitHubManager.updateFile(
            'data/index.json',
            indexData,
            `Update index file`,
            indexFile.sha
        );
    }

    async handleDelete(id) {
        try {
            await this.connection.beginTransaction();

            // 1. 删除数据库记录
            await this.connection.execute('DELETE FROM material_data WHERE id = ?', [id]);
            await this.connection.execute('DELETE FROM material_info WHERE id = ?', [id]);

            // 2. 删除GitHub文件
            const file = await this.gitHubManager.getFileContent(`data/ids/${id}.json`);
            if (file) {
                await this.gitHubManager.deleteFile(
                    `data/ids/${id}.json`,
                    `Delete material ${id}`,
                    file.sha
                );
            }

            // 3. 更新索引文件
            await this.updateIndexFile(id);

            await this.connection.commit();
            return true;
        } catch (error) {
            await this.connection.rollback();
            throw error;
        }
    }

    async handleStatusUpdate(id, newStatus) {
        try {
            // 开始数据库事务
            await this.connection.beginTransaction();

            // 1. 更新数据库
            await this.connection.execute(
                'UPDATE material_info SET current_status = ? WHERE id = ?',
                [newStatus, id]
            );

            // 2. 更新 GitHub 文件
            const file = await this.gitHubManager.getFileContent(`data/ids/${id}.json`);
            if (file) {
                const data = JSON.parse(file.content);
                data.current_status = newStatus;
                await this.gitHubManager.updateFile(
                    `data/ids/${id}.json`,
                    data,
                    `Update status for material ${id}`,
                    file.sha
                );
            }

            // 3. 更新金山云文档
            await this.airScriptClient.updateStatus(id, newStatus);

            // 4. 更新索引文件
            await this.updateIndexFile(null, { id, newStatus });

            // 提交事务
            await this.connection.commit();
            return true;
        } catch (error) {
            // 回滚事务
            await this.connection.rollback();
            throw error;
        }
    }
}

// 主函数
async function main() {
    let connection;
    let issueNumber;

    try {
        // 验证环境变量
        const requiredEnvVars = [
            'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
            'GITHUB_TOKEN', 'AIRSCRIPT_TOKEN', 'AIRSCRIPT_URL'
        ];
        
        for (const envVar of requiredEnvVars) {
            if (!process.env[envVar]) {
                throw new Error(`Missing required environment variable: ${envVar}`);
            }
        }

        // 创建数据库连接
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        const octokit = new Octokit({
            auth: process.env.GITHUB_TOKEN
        });

        const airScriptClient = new AirScriptClient(
            process.env.AIRSCRIPT_TOKEN,
            process.env.AIRSCRIPT_URL
        );

        const processor = new OperationProcessor(connection, octokit, airScriptClient);

        // 获取 Issue 内容
        const eventData = JSON.parse(
            await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')
        );
        
        issueNumber = eventData.issue.number;
        const { data: issue } = await octokit.issues.get({
            owner: 'Echony',
            repo: 'echony-data-storage',
            issue_number: issueNumber
        });

        const operation = parseIssueBody(issue.body);

        let result;
        switch (operation.type) {
            case 'delete':
                result = await processor.handleDelete(operation.id);
                break;
            case 'updateStatus':
                result = await processor.handleStatusUpdate(operation.id, operation.newStatus);
                break;
            default:
                throw new Error('Unknown operation type');
        }

        // 添加成功评论
        await octokit.issues.createComment({
            owner: 'Echony',
            repo: 'echony-data-storage',
            issue_number: issueNumber,
            body: '✅ Operation completed successfully'
        });

        // 关闭 Issue
        await octokit.issues.update({
            owner: 'Echony',
            repo: 'echony-data-storage',
            issue_number: issueNumber,
            state: 'closed'
        });

    } catch (error) {
        console.error('Fatal error:', error);

        if (issueNumber) {
            try {
                await octokit.issues.createComment({
                    owner: 'Echony',
                    repo: 'echony-data-storage',
                    issue_number: issueNumber,
                    body: `❌ Operation failed: ${error.message}\n\n${error.stack}`
                });
            } catch (commentError) {
                console.error('Failed to create error comment:', commentError);
            }
        }

        process.exit(1);
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (error) {
                console.error('Error closing database connection:', error);
            }
        }
    }
}

main().catch(console.error);
