import sqlite3
import json
import os
from datetime import datetime

# Database file path
DB_PATH = os.path.join(os.path.dirname(__file__), 'filters.db')

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create filters table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS saved_filters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            filter_name TEXT NOT NULL,
            filters_data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create index for faster lookups
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_username ON saved_filters(username)
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")

def save_filters(username, filter_name, filters_data):
    """Save filters for a user"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Convert filters_data to JSON string
        filters_json = json.dumps(filters_data)
        
        # Check if filter name already exists for this user
        cursor.execute('''
            SELECT id FROM saved_filters 
            WHERE username = ? AND filter_name = ?
        ''', (username, filter_name))
        
        existing = cursor.fetchone()
        
        if existing:
            # Update existing filter
            cursor.execute('''
                UPDATE saved_filters 
                SET filters_data = ?, updated_at = CURRENT_TIMESTAMP
                WHERE username = ? AND filter_name = ?
            ''', (filters_json, username, filter_name))
            action = "updated"
        else:
            # Insert new filter
            cursor.execute('''
                INSERT INTO saved_filters (username, filter_name, filters_data)
                VALUES (?, ?, ?)
            ''', (username, filter_name, filters_json))
            action = "saved"
        
        conn.commit()
        return {"success": True, "action": action, "message": f"Filters {action} successfully"}
        
    except Exception as e:
        conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        conn.close()

def load_filters(username, filter_name=None):
    """Load filters for a user"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        if filter_name:
            # Load specific filter set
            cursor.execute('''
                SELECT filter_name, filters_data, created_at, updated_at
                FROM saved_filters 
                WHERE username = ? AND filter_name = ?
            ''', (username, filter_name))
            result = cursor.fetchone()
            
            if result:
                return {
                    "success": True,
                    "filter_name": result[0],
                    "filters": json.loads(result[1]),
                    "created_at": result[2],
                    "updated_at": result[3]
                }
            else:
                return {"success": False, "error": "Filter set not found"}
        else:
            # Load all filter sets for user
            cursor.execute('''
                SELECT filter_name, filters_data, created_at, updated_at
                FROM saved_filters 
                WHERE username = ?
                ORDER BY updated_at DESC
            ''', (username,))
            results = cursor.fetchall()
            
            filter_sets = []
            for row in results:
                filter_sets.append({
                    "filter_name": row[0],
                    "filters": json.loads(row[1]),
                    "created_at": row[2],
                    "updated_at": row[3]
                })
            
            return {"success": True, "filter_sets": filter_sets}
            
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        conn.close()

def delete_filters(username, filter_name):
    """Delete a filter set for a user"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            DELETE FROM saved_filters 
            WHERE username = ? AND filter_name = ?
        ''', (username, filter_name))
        
        if cursor.rowcount > 0:
            conn.commit()
            return {"success": True, "message": "Filter set deleted successfully"}
        else:
            return {"success": False, "error": "Filter set not found"}
            
    except Exception as e:
        conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        conn.close()

def get_user_filter_names(username):
    """Get all filter names for a user"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            SELECT filter_name, updated_at
            FROM saved_filters 
            WHERE username = ?
            ORDER BY updated_at DESC
        ''', (username,))
        results = cursor.fetchall()
        
        filter_names = [{"name": row[0], "updated_at": row[1]} for row in results]
        return {"success": True, "filter_names": filter_names}
        
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        conn.close()

# Initialize database when module is imported
if __name__ == "__main__":
    init_db()
