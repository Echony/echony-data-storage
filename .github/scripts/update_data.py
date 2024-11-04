import os
import json
import pymysql
import pandas as pd
from datetime import datetime, timedelta
import pytz

def connect_to_database():
    """连接到MySQL数据库"""
    try:
        connection = pymysql.connect(
            host=os.getenv('DB_HOST'),
            port=int(os.getenv('DB_PORT')),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD'),
            database=os.getenv('DB_NAME')
        )
        return connection
    except Exception as e:
        raise Exception(f"数据库连接失败: {str(e)}")

def convert_to_china_timezone(df):
    """将时间转换为中国时区"""
    china_tz = pytz.timezone('Asia/Shanghai')
    df['record_date'] = pd.to_datetime(df['record_date']).dt.tz_localize(pytz.UTC).dt.tz_convert(china_tz)
    return df

def fetch_data():
    """从数据库获取数据"""
    connection = connect_to_database()
    try:
        query = """
            SELECT * FROM test1.material_data 
            ORDER BY record_date DESC
        """
        df = pd.read_sql(query, connection)
        df = convert_to_china_timezone(df)
        return df
    finally:
        connection.close()

def process_latest_data(df):
    """处理最新数据"""
    latest_data = df.iloc[0].to_dict()
    latest_data['record_date'] = latest_data['record_date'].strftime('%Y-%m-%d %H:%M:%S')
    return latest_data

def process_historical_metrics(df):
    """处理历史指标数据"""
    metrics = {}
    for column in df.columns:
        if column not in ['ID', 'record_date']:
            metrics[column] = df[column].tolist()
    
    metrics['timestamps'] = df['record_date'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
    return metrics

def process_summary(df):
    """处理数据摘要"""
    summary = {
        'last_update': df['record_date'].max().strftime('%Y-%m-%d %H:%M:%S'),
        'total_records': len(df),
        'metrics_summary': {}
    }
    
    for column in df.columns:
        if column not in ['ID', 'record_date']:
            summary['metrics_summary'][column] = {
                'max': float(df[column].max()),
                'min': float(df[column].min()),
                'avg': float(df[column].mean()),
                'current': float(df.iloc[0][column])
            }
    
    return summary

def process_cached_data(df):
    """处理缓存数据"""
    now = pd.Timestamp.now(pytz.timezone('Asia/Shanghai'))
    
    # 最近24小时数据
    last_24h = df[df['record_date'] >= now - timedelta(hours=24)]
    hour_24_data = process_historical_metrics(last_24h)
    
    # 最近30天数据
    last_30d = df[df['record_date'] >= now - timedelta(days=30)]
    day_30_data = process_historical_metrics(last_30d)
    
    return hour_24_data, day_30_data

def save_json(data, filename):
    """保存JSON文件"""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    """主函数"""
    try:
        # 获取数据
        df = fetch_data()
        
        # 确保目录存在
        os.makedirs('data/historical/archived', exist_ok=True)
        os.makedirs('data/cache', exist_ok=True)
        
        # 处理并保存各类数据
        latest_data = process_latest_data(df)
        save_json(latest_data, 'data/latest.json')
        
        metrics_data = process_historical_metrics(df)
        save_json(metrics_data, 'data/historical/metrics.json')
        
        summary_data = process_summary(df)
        save_json(summary_data, 'data/historical/summary.json')
        
        hour_24_data, day_30_data = process_cached_data(df)
        save_json(hour_24_data, 'data/cache/hour-24.json')
        save_json(day_30_data, 'data/cache/day-30.json')
        
        print("数据更新成功！")
        
    except Exception as e:
        print(f"错误: {str(e)}")
        raise e

if __name__ == "__main__":
    main()
