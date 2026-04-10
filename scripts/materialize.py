"""
Materialize gold views into web schema tables.

Reads from cae gold views (live computation), writes to web schema (flat tables).
Web schema tables are what gets synced to Railway and served by the portal.

Usage:
    python materialize.py                  # Materialize all configured views
    python materialize.py --view escrow    # Materialize just escrow_complete

Run after RBJ extraction completes. Designed to be added to the CAE morning
ops pipeline (PIPE_cae_morning_ops) as a post-extraction step.
"""

import psycopg2
import os
import sys
from datetime import datetime

# PostgreSQL connection — local
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_PORT = os.environ.get('PG_PORT', '5432')
PG_DATABASE = os.environ.get('PG_DATABASE', 'mpower')
PG_USER = os.environ.get('PG_USER', 'postgres')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

# Views to materialize: (source_view, target_table)
MATERIALIZATION_PLAN = [
    {
        'name': 'escrow_complete',
        'source': 'cae.gold_vw_escrow_complete',
        'target': 'web.escrow_complete',
        'description': 'Master escrow view — all enrichments, task counts, dim lookups',
    },
    {
        'name': 'task_complete',
        'source': 'cae.gold_vw_task_complete',
        'target': 'web.task_complete',
        'description': 'Full task enrichment — 55 columns, task + escrow data joined',
    },
]


def materialize(conn, plan_item):
    """Materialize a single view into a flat table."""
    cur = conn.cursor()
    source = plan_item['source']
    target = plan_item['target']
    name = plan_item['name']

    start = datetime.now()
    print(f'  [{name}] Materializing {source} -> {target}...')

    # Drop and recreate (atomic — if something fails, old table is gone)
    # Use a temp table + rename for safer approach
    temp_table = f"{target}_new"

    try:
        cur.execute(f'DROP TABLE IF EXISTS {temp_table}')
        cur.execute(f'CREATE TABLE {temp_table} AS SELECT * FROM {source}')

        cur.execute(f'SELECT COUNT(*) FROM {temp_table}')
        new_count = cur.fetchone()[0]

        # Swap: drop old, rename new
        cur.execute(f'DROP TABLE IF EXISTS {target}')
        cur.execute(f'ALTER TABLE {temp_table} RENAME TO {target.split(".")[-1]}')

        # Set schema if needed (ALTER TABLE only renames within same schema)
        conn.commit()

        elapsed = (datetime.now() - start).total_seconds()
        print(f'  [{name}] Done: {new_count:,} rows in {elapsed:.1f}s')
        return new_count

    except Exception as e:
        conn.rollback()
        print(f'  [{name}] FAILED: {e}')
        return -1


def main():
    # Parse args
    only_view = None
    if '--view' in sys.argv:
        idx = sys.argv.index('--view')
        if idx + 1 < len(sys.argv):
            only_view = sys.argv[idx + 1]

    # Connect
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, database=PG_DATABASE,
        user=PG_USER, password=PG_PASSWORD
    )
    cur = conn.cursor()

    # Ensure web schema exists
    cur.execute('CREATE SCHEMA IF NOT EXISTS web')
    conn.commit()

    print('=' * 60)
    print('MATERIALIZE — Gold Views to Web Tables')
    print(f'Started: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'Database: {PG_DATABASE} @ {PG_HOST}')
    print('=' * 60)

    total_rows = 0
    total_views = 0

    for item in MATERIALIZATION_PLAN:
        if only_view and item['name'] != only_view:
            continue

        rows = materialize(conn, item)
        if rows >= 0:
            total_rows += rows
            total_views += 1

    print('=' * 60)
    print(f'Complete: {total_views} views materialized, {total_rows:,} total rows')
    print(f'Finished: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    conn.close()


if __name__ == '__main__':
    main()
