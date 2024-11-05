const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

function formatChineseDateTime(date) {
    // 转换为中国时区 (UTC+8)
    const chinaTime = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    
    const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(chinaTime.getUTCDate()).padStart(2, '0');
    const hours = String(chinaTime.getUTCHours()).padStart(2, '0');
    const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0');
    
    return `${month}-${day} ${hours}:${minutes}`;
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

        console.log('Fetching data from database...');
        const [rows] = await connection.execute(
            'SELECT * FROM material_data WHERE record_date >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY record_date DESC'
        );
        console.log(`Found ${rows.length} records`);

        const groupedData = {};
        rows.forEach(row => {
            if (!groupedData[row.ID]) {
                groupedData[row.ID] = {
                    id: row.ID,
                    data: []
                };
            }
            groupedData[row.ID].data.push({
                record_date: formatChineseDateTime(new Date(row.record_date)),
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

        console.log('Updating individual ID files...');
        const updatePromises = Object.entries(groupedData).map(async ([id, data]) => {
            const filePath = path.join(idsDir, `${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`Updated file for ID: ${id}`);
        });
        await Promise.all(updatePromises);

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
