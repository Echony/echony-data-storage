
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function main() {
    // 创建数据库连接
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: true
        }
    });

    try {
        // 获取最新数据
        const [rows] = await connection.execute(
            'SELECT * FROM material_data WHERE record_date >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY record_date DESC'
        );

        // 按ID分组数据
        const groupedData = {};
        rows.forEach(row => {
            if (!groupedData[row.ID]) {
                groupedData[row.ID] = {
                    id: row.ID,
                    data: []
                };
            }
            groupedData[row.ID].data.push({
                record_date: row.record_date,
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
        });

        // 确保目录存在
        await fs.mkdir('data/ids', { recursive: true });

        // 更新每个ID的数据文件
        for (const [id, data] of Object.entries(groupedData)) {
            await fs.writeFile(
                path.join('data/ids', `${id}.json`),
                JSON.stringify(data, null, 2)
            );
        }

        // 更新索引文件
        const indexData = {
            available_ids: Object.keys(groupedData),
            last_updated: new Date().toISOString()
        };
        await fs.writeFile(
            path.join('data', 'index.json'),
            JSON.stringify(indexData, null, 2)
        );

    } finally {
        await connection.end();
    }
}

main().catch(console.error);
