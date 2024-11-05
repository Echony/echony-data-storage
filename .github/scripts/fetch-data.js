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

// 获取当前时间并转换为中国时区 (UTC +8)
function getChinaTime() {
    const date = new Date();
    const options = {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    };
    return new Intl.DateTimeFormat('en-GB', options).format(date);
}

// 格式化数字，保留两位小数
function formatData(value) {
    return parseFloat(value).toFixed(2);
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
            if (!groupedData[row.ID]) {
                groupedData[row.ID] = {
                    id: row.ID,
                    data: []
                };
            }
            groupedData[row.ID].data.push({
                record_date: row.record_date,
                roi: formatData(row.roi),
                overall_impressions: formatData(row.overall_impressions),
                overall_clicks: formatData(row.overall_clicks),
                overall_ctr: formatData(row.overall_ctr),
                overall_conversion_rate: formatData(row.overall_conversion_rate),
                overall_orders: formatData(row.overall_orders),
                overall_sales: formatData(row.overall_sales),
                overall_spend: formatData(row.overall_spend),
                spend_percentage: formatData(row.spend_percentage),
                basic_spend: formatData(row.basic_spend),
                cost_per_order: formatData(row.cost_per_order)
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
            last_updated: getChinaTime() // 获取中国时区的时间
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
