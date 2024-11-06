const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 格式化数字，保留两位小数
function formatNumber(num) {
    if (num === null || num === undefined) return null;
    return Number(Number(num).toFixed(2));
}

// 格式化日期为中国时区的"月、日、时、分"格式
function formatDate(date) {
    // 转换为中国时区 (UTC+8)
    const chinaDate = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    
    const month = chinaDate.getUTCMonth() + 1; // 月份从0开始
    const day = chinaDate.getUTCDate();
    const hour = chinaDate.getUTCHours();
    const minute = chinaDate.getUTCMinutes();

    return `${month}月${day}日${hour}时${minute}分`;
}

async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch (error) {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function main() {
    console.log('Starting data fetch process...');
    
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        const dataDir = path.join(process.cwd(), 'data');
        const idsDir = path.join(dataDir, 'ids');
        
        console.log('Creating directory structure...');
        await ensureDirectoryExists(dataDir);
        await ensureDirectoryExists(idsDir);

        console.log('Fetching active materials...');
        const [materials] = await connection.execute(
            'SELECT id, current_status FROM material_info'
        );

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

        const groupedData = {};
        materials.forEach(material => {
            groupedData[material.id] = {
                id: material.id,
                current_status: material.current_status,
                data: []
            };
        });

        // 格式化数据
        rows.forEach(row => {
            if (groupedData[row.id]) {
                groupedData[row.id].data.push({
                    record_date: formatDate(row.record_date),
                    status: row.status,
                    roi: formatNumber(row.roi),
                    overall_impressions: row.overall_impressions,
                    overall_clicks: row.overall_clicks,
                    overall_ctr: formatNumber(row.overall_ctr),
                    overall_conversion_rate: formatNumber(row.overall_conversion_rate),
                    overall_orders: row.overall_orders,
                    overall_sales: formatNumber(row.overall_sales),
                    overall_spend: formatNumber(row.overall_spend),
                    spend_percentage: formatNumber(row.spend_percentage),
                    basic_spend: formatNumber(row.basic_spend),
                    cost_per_order: formatNumber(row.cost_per_order)
                });
            }
        });

        console.log('Updating individual ID files...');
        const updatePromises = Object.entries(groupedData).map(async ([id, data]) => {
            const filePath = path.join(idsDir, `${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`Updated file for ID: ${id}`);
        });

        await Promise.all(updatePromises);

        console.log('Updating index file...');
        const indexData = {
            materials: materials.map(m => ({
                id: m.id,
                current_status: m.current_status
            })),
            last_updated: formatDate(new Date())
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
