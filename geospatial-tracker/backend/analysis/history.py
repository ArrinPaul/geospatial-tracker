"""
Historical data store — saves GeoJSON snapshots for replay.
Uses SQLite by default (zero-config), can be swapped to PostgreSQL/TimescaleDB.
"""

import json
import sqlite3
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "history.db"


class HistoryStore:
    """SQLite-based historical GeoJSON snapshot store."""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    city TEXT NOT NULL DEFAULT 'los_angeles',
                    feature_count INTEGER NOT NULL DEFAULT 0,
                    aircraft_count INTEGER NOT NULL DEFAULT 0,
                    vehicle_count INTEGER NOT NULL DEFAULT 0,
                    geojson TEXT NOT NULL,
                    alerts TEXT DEFAULT '[]'
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_snapshots_time
                ON snapshots(timestamp)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_snapshots_city
                ON snapshots(city)
            """)
            conn.commit()
        logger.info(f"History database initialized at {self.db_path}")

    def save_snapshot(
        self,
        geojson: dict,
        city: str = "los_angeles",
        alerts: list | None = None,
    ):
        """Save a detection cycle snapshot."""
        features = geojson.get("features", [])
        aircraft_count = sum(
            1 for f in features if f.get("properties", {}).get("category") == "aircraft"
        )
        vehicle_count = sum(
            1 for f in features
            if f.get("properties", {}).get("category") in ("vehicles", "vehicle")
        )

        now = datetime.now(timezone.utc).isoformat()
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """INSERT INTO snapshots
                       (timestamp, city, feature_count, aircraft_count, vehicle_count, geojson, alerts)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        now,
                        city,
                        len(features),
                        aircraft_count,
                        vehicle_count,
                        json.dumps(geojson),
                        json.dumps(alerts or []),
                    ),
                )
                conn.commit()
        except Exception as e:
            logger.error(f"Failed to save snapshot: {e}")

        # Auto-cleanup: keep last 24 hours only (SQLite)
        self._cleanup_old(conn=None)

    def get_snapshots(
        self,
        city: str = "los_angeles",
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Get historical snapshots (metadata only, no full GeoJSON)."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """SELECT id, timestamp, city, feature_count, aircraft_count, vehicle_count
                       FROM snapshots
                       WHERE city = ?
                       ORDER BY timestamp DESC
                       LIMIT ? OFFSET ?""",
                    (city, limit, offset),
                ).fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch snapshots: {e}")
            return []

    def get_snapshot_by_id(self, snapshot_id: int) -> dict | None:
        """Get a full snapshot with GeoJSON data by ID."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)
                ).fetchone()
                if row:
                    result = dict(row)
                    result["geojson"] = json.loads(result["geojson"])
                    result["alerts"] = json.loads(result["alerts"])
                    return result
                return None
        except Exception as e:
            logger.error(f"Failed to fetch snapshot {snapshot_id}: {e}")
            return None

    def get_timeline(self, city: str = "los_angeles", hours: int = 24) -> list[dict]:
        """Get aggregated timeline data for charts."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """SELECT id, timestamp, feature_count, aircraft_count, vehicle_count
                       FROM snapshots
                       WHERE city = ?
                         AND timestamp >= datetime('now', ?)
                       ORDER BY timestamp ASC""",
                    (city, f"-{hours} hours"),
                ).fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch timeline: {e}")
            return []

    def _cleanup_old(self, conn=None, max_hours: int = 48):
        """Remove snapshots older than max_hours."""
        try:
            with sqlite3.connect(self.db_path) as c:
                c.execute(
                    "DELETE FROM snapshots WHERE timestamp < datetime('now', ?)",
                    (f"-{max_hours} hours",),
                )
                c.commit()
        except Exception as e:
            logger.error(f"Cleanup failed: {e}")

    def get_stats(self) -> dict:
        """Get database statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                total = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
                size_bytes = self.db_path.stat().st_size if self.db_path.exists() else 0
                return {
                    "total_snapshots": total,
                    "db_size_bytes": size_bytes,
                    "db_size_mb": round(size_bytes / 1024 / 1024, 2),
                    "db_path": str(self.db_path),
                }
        except Exception as e:
            logger.error(f"Stats failed: {e}")
            return {"total_snapshots": 0, "db_size_bytes": 0}


# Global instance
history_store = HistoryStore()
