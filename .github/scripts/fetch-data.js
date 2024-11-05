const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch (error) {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

// 格式化数字为两位小数
function formatNumber(num) {
    return Number(parseFloat(num).toFixed(2));
}

// 格式化时间为 "月，日，时，分" 格式
function formatChineseTime(date) {
    const d = new Date(date);
    // 转换为中国时区
    const chinaDate = new Date(d.getTime() + (8 * 60 * 60 * 1000));
    
    const month = chinaDate.getMonth() + 1; // getMonth() 返回 0-11
    const day = chinaDate.getDate();
    const hours = chinaDate.getHours();
    const minutes = chinaDate.getMinutes();
    
    return `${month}，${day}，${hours}，${minutes}`;
}

async function main() {
    console.log('Starting data fetch process...');
    
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
        }
    });

    try {
        const dataDir = path.join(process.cwd(), 'data');
        const idsDir = path.join(dataDir, 'ids');
        
        console.log('Creating directory structure...');
        await ensureDirectoryExists(dataDir);
        await ensureDirectoryExists(idsDir);

        console.log('Fetching data from database...');
        const [rows] = await connection.execute(
            'SELECT * FROM material_data WHERE record_date >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY record_date DESC'
        );
        console.log(`Found ${rows.length} records`);

        const groupedData = {};
        rows.forEach(row => {
            const id = row.ID; // 使用大写的ID，与数据库字段保持一致
            if (!groupedData[id]) {
                groupedData[id] = {
                    id: id,
                    data: []
                };
            }
            groupedData[id].data.push({
                record_date: formatChineseTime(row.record_date),
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
        });

        console.log('Updating individual ID files...');
        const updatePromises = Object.entries(groupedData).map(async ([id, data]) => {
            if (id && id !== 'undefined') {  // 添加检查确保ID有效
                const filePath = path.join(idsDir, `${id}.json`);
                await fs.writeFile(filePath, JSON.stringify(data, null, 2));
                console.log(`Updated file for ID: ${id}`);
            }
        });
        await Promise.all(updatePromises);

        console.log('Updating index file...');
        const indexData = {
            available_ids: Object.keys(groupedData).filter(id => id && id !== 'undefined'),
            last_updated: formatChineseTime(new Date())
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
