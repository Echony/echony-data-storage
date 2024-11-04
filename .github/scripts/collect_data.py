import os
import json
import mysql.connector
import pandas as pd
from datetime import datetime

def get_database_connection():
    return mysql.connector.connect(
        host=os.getenv('DB_HOST'),
        port=int(os.getenv('DB_PORT')),
        user=os.getenv('DB_USER'),
        password=os.getenv('DB_PASSWORD'),
        database=os.getenv('DB_NAME'),
        ssl_mode="REQUIRED"
    )

def main():
    # 连接数据库
    conn = get_database_connection()
    
    # 获取最新数据
    query = """
    SELECT * FROM material_data 
    ORDER BY record_date DESC 
    LIMIT 1
    """
    
    df = pd.read_sql(query, conn)
    
    # 转换数据为JSON格式
    latest_data = df.to_dict('records')[0]
    
    # 更新latest.json
    with open('data/latest.json', 'w', encoding='utf-8') as f:
        json.dump(latest_data, f, indent=2, default=str)
    
    # 更新metadata.json
    metadata = {
        "last_updated": datetime.now().isoformat(),
        "record_count": 1
    }
    
    with open('data/metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)
    
    conn.close()

if __name__ == "__main__":
    main()
