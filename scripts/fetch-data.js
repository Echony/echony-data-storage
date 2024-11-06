const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 辅助函数：格式化数字保留两位小数
function formatNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        return num;
    }
    return Number(num.toFixed(2));
}

// 辅助函数：转换时间到中国时区并格式化
function formatDate(date) {
    if (!date) return null;
    const chinaDate = new Date(date);
    chinaDate.setHours(chinaDate.getHours() + 8);
    
    const month = chinaDate.getUTCMonth() + 1;
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
    
    // 添加数据库连接配置日志
    console.log('Database connection config:', {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        database: process.env.DB_NAME
    });

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
        
        await ensureDirectoryExists(dataDir);
        await ensureDirectoryExists(idsDir);

        // 获取活跃素材
        console.log('Fetching active materials...');
        const [materials] = await connection.execute(
            'SELECT id, current_status FROM material_info'
        );
        console.log('Found materials:', materials.length);
        console.log('Sample material:', materials[0]);

        // 修改SQL查询，添加更多调试信息
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
        console.log('Found data rows:', rows.length);
        if (rows.length > 0) {
            console.log('Sample row:', JSON.stringify(rows[0], null, 2));
        }

        // 按ID分组数据
        const groupedData = {};
        materials.forEach(material => {
            groupedData[material.id] = {
                id: material.id,
                current_status: material.current_status,
                data: []
            };
        });

        // 添加详细数据（包含错误处理）
        rows.forEach((row, index) => {
            if (groupedData[row.id]) {
                try {
                    groupedData[row.id].data.push({
                        record_date: formatDate(row.record_date),
                        status: row.status,
                        roi: formatNumber(row.roi),
                        overall_impressions: formatNumber(row.overall_impressions),
                        overall_clicks: formatNumber(row.overall_clicks),
                        overall_ctr: formatNumber(row.overall_ctr),
                        overall_conversion_rate: formatNumber(row.overall_conversion_rate),
                        overall_orders: formatNumber(row.overall_orders),
                        overall_sales: formatNumber(row.overall_sales),
                        overall_spend: formatNumber(row.overall_spend),
                        spend_percentage: formatNumber(row.spend_percentage),
                        basic_spend: formatNumber(row.basic_spend),
                        cost_per_order: formatNumber(row.cost_per_order)
                    });
                } catch (error) {
                    console.error(`Error processing row ${index}:`, error);
                    console.error('Problematic row:', row);
                }
            } else {
                console.warn(`No matching material found for id: ${row.id}`);
            }
        });

        // 检查处理后的数据
        Object.entries(groupedData).forEach(([id, data]) => {
            if (data.data.length === 0) {
                console.log(`No data found for ID: ${id}, status: ${data.current_status}`);
            }
        });

        // 更新文件
        console.log('Updating individual ID files...');
        const updatePromises = Object.entries(groupedData).map(async ([id, data]) => {
            const filePath = path.join(idsDir, `${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`Updated file for ID: ${id}, data length: ${data.data.length}`);
        });

        await Promise.all(updatePromises);

        // 更新索引文件
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
        console.error('Error details:', error.stack);
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
