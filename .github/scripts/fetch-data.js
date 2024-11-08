const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 辅助函数：格式化时间为中国时区
function formatChineseDateTime(date) {
    const options = {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    return new Date(date).toLocaleString('zh-CN', options);
}

// 辅助函数：格式化数字为保留两位小数
function formatNumber(number) {
    return number === null ? null : Number(number.toFixed(2));
}

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
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: true
        }
    });

    try {
        // 确保基础目录结构存在
        const dataDir = path.join(process.cwd(), 'data');
        const idsDir = path.join(dataDir, 'ids');
        
        console.log('Creating directory structure...');
        await ensureDirectoryExists(dataDir);
        await ensureDirectoryExists(idsDir);

        // 获取最新数据
        console.log('Fetching data from database...');
        const [rows] = await connection.execute(
            'SELECT * FROM material_data WHERE record_date >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY record_date DESC'
        );
        console.log(`Found ${rows.length} records`);

        // 按ID分组数据
        const groupedData = {};
        rows.forEach(row => {
            if (!groupedData[row.id]) {  // 改为小写的 id
                groupedData[row.id] = {   // 改为小写的 id
                    id: row.id,           // 改为小写的 id
                    data: []
                };
            }
            groupedData[row.id].data.push({  // 改为小写的 id
                record_date: formatChineseDateTime(row.record_date),
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
        });

        // 更新每个ID的数据文件
        console.log('Updating individual ID files...');
        const updatePromises = Object.entries(groupedData).map(async ([id, data]) => {
            const filePath = path.join(idsDir, `${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`Updated file for ID: ${id}`);
        });
        await Promise.all(updatePromises);

        // 更新索引文件
        console.log('Updating index file...');
        const indexData = {
            available_ids: Object.keys(groupedData),
            last_updated: formatChineseDateTime(new Date())
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
