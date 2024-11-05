const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch (error) {
        // 如果目录不存在，创建它
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function main() {
    console.log('Starting data fetch process...');
    
    // 创建数据库连接
    console.log('Connecting to database...');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        // 确保基础目录结构存在
        const dataDir = path.join(process.cwd(), 'data');
        const idsDir = path.join(dataDir, 'ids');
        
        console.log('Creating directory structure...');
        await ensureDirectoryExists(dataDir);
        await ensureDirectoryExists(idsDir);

        // 获取所有活跃的素材ID和它们的当前状态
        console.log('Fetching active materials...');
        const [materials] = await connection.execute(
            'SELECT id, current_status FROM material_info'
        );

        // 获取最近24小时的数据记录
        console.log('Fetching recent data from database...');
        const [rows] = await connection.execute(`
            SELECT 
                d.*,
                i.current_status
            FROM material_data d
            JOIN material_info i ON d.id = i.id
            WHERE d.record_date >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY d.record_date DESC
        `);

        console.log(`Found ${rows.length} records for ${materials.length} materials`);

        // 按ID分组数据
        const groupedData = {};
        materials.forEach(material => {
            groupedData[material.id] = {
                id: material.id,
                current_status: material.current_status,
                data: []
            };
        });

        // 添加详细数据
        rows.forEach(row => {
            if (groupedData[row.id]) {
                groupedData[row.id].data.push({
                    record_date: row.record_date,
                    status: row.status,
                    roi: row.roi,
                    overall_impressions: row.overall_impressions,
                    overall_clicks: row.overall_clicks,
                    overall_ctr: row.overall_ctr,
                    overall_conversion_rate: row.overall_conversion_rate,
                    overall_orders: row.overall_orders,
                    overall_sales: row.overall_sales,
                    overall_spend: row.overall_spend,
                    spend_percentage: row.spend_percentage,
                    basic_spend: row.basic_spend,
                    cost_per_order: row.cost_per_order
                });
            }
        });

        // 更新每个ID的数据文件
        console.log('Updating individual ID files...');
        const updatePromises = Object.entries(groupedData).map(async ([id, data]) => {
            const filePath = path.join(idsDir, `${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`Updated file for ID: ${id}`);
        });

        await Promise.all(updatePromises);

        // 更新索引文件，包含ID和它们的当前状态
        console.log('Updating index file...');
        const indexData = {
            materials: materials.map(m => ({
                id: m.id,
                current_status: m.current_status
            })),
            last_updated: new Date().toISOString()
        };
        
        await fs.writeFile(
            path.join(dataDir, 'index.json'),
            JSON.stringify(indexData, null, 2)
        );

        console.log('Data update completed successfully!');

    } catch (error) {
        console.error('Error during data update:', error);
        throw error;
    } finally {
        await connection.end();
        console.log('Database connection closed.');
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
