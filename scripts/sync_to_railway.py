"""
Sync web schema tables from local PostgreSQL to Railway PostgreSQL.

Reads materialized tables from local web schema, truncates and reloads
on Railway. Idempotent — safe to run repeatedly.

Usage:
    python sync_to_railway.py              # Sync all web tables
    python sync_to_railway.py --table escrow_complete  # Sync one table

Requires:
    PG_PASSWORD (local) and RAILWAY_PG_PASSWORD environment variables,
    or retrieves from Azure Key Vault.
"""

import psycopg2
import os
import sys
import subprocess
from datetime import datetime
from io import StringIO


# Local PostgreSQL
LOCAL_HOST = os.environ.get('PG_HOST', 'localhost')
LOCAL_PORT = os.environ.get('PG_PORT', '5432')
LOCAL_DB = os.environ.get('PG_DATABASE', 'mpower')
LOCAL_USER = os.environ.get('PG_USER', 'postgres')
LOCAL_PASS = os.environ.get('PG_PASSWORD', '')

# Railway PostgreSQL
RAILWAY_HOST = os.environ.get('RAILWAY_PG_HOST', 'mainline.proxy.rlwy.net')
RAILWAY_PORT = os.environ.get('RAILWAY_PG_PORT', '39594')
RAILWAY_DB = os.environ.get('RAILWAY_PG_DATABASE', 'mpower')
RAILWAY_USER = os.environ.get('RAILWAY_PG_USER', 'postgres')
RAILWAY_PASS = os.environ.get('RAILWAY_PG_PASSWORD', '')


def get_vault_secret(name):
    """Retrieve a secret from Azure Key Vault."""
    try:
        result = subprocess.run(
            ['az', 'keyvault', 'secret', 'show', '--vault-name', 'thomos-vault',
             '--name', name, '--query', 'value', '-o', 'tsv'],
            capture_output=True, text=True, timeout=15
        )
        return result.stdout.strip() if result.returncode == 0 else ''
    except Exception:
        return ''


def sync_table(local_conn, railway_conn, table_name):
    """Sync a single table from local to Railway using COPY."""
    start = datetime.now()
    print(f'  [{table_name}] Syncing...')

    local_cur = local_conn.cursor()
    railway_cur = railway_conn.cursor()

    try:
        # Get column list from local
        local_cur.execute(f"""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'web' AND table_name = '{table_name}'
            ORDER BY ordinal_position
        """)
        columns = [r[0] for r in local_cur.fetchall()]

        if not columns:
            print(f'  [{table_name}] SKIPPED — table not found in local web schema')
            return -1

        # Export from local using COPY to a string buffer
        buf = StringIO()
        local_cur.copy_expert(
            f'COPY web."{table_name}" TO STDOUT WITH CSV HEADER',
            buf
        )
        buf.seek(0)

        local_cur.execute(f'SELECT COUNT(*) FROM web."{table_name}"')
        local_count = local_cur.fetchone()[0]

        # Ensure web schema exists on Railway
        railway_cur.execute('CREATE SCHEMA IF NOT EXISTS web')
        railway_conn.commit()

        # Create table on Railway if it doesn't exist (match local structure)
        local_cur.execute(f"""
            SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = 'web' AND table_name = '{table_name}'
            ORDER BY ordinal_position
        """)
        col_defs = []
        for col_name, data_type, char_max, num_prec, num_scale in local_cur.fetchall():
            if data_type == 'character varying' and char_max:
                col_defs.append(f'"{col_name}" varchar({char_max})')
            elif data_type == 'numeric' and num_prec:
                col_defs.append(f'"{col_name}" numeric({num_prec},{num_scale or 0})')
            else:
                col_defs.append(f'"{col_name}" {data_type}')

        create_sql = f'CREATE TABLE IF NOT EXISTS web."{table_name}" ({", ".join(col_defs)})'
        railway_cur.execute(create_sql)
        railway_conn.commit()

        # Truncate Railway table
        railway_cur.execute(f'TRUNCATE TABLE web."{table_name}"')
        railway_conn.commit()

        # Load via COPY
        buf.seek(0)
        railway_cur.copy_expert(
            f'COPY web."{table_name}" FROM STDIN WITH CSV HEADER',
            buf
        )
        railway_conn.commit()

        # Verify
        railway_cur.execute(f'SELECT COUNT(*) FROM web."{table_name}"')
        railway_count = railway_cur.fetchone()[0]

        elapsed = (datetime.now() - start).total_seconds()
        match = 'MATCH' if local_count == railway_count else 'MISMATCH'
        print(f'  [{table_name}] Done: local={local_count:,} railway={railway_count:,} ({match}) in {elapsed:.1f}s')

        return railway_count

    except Exception as e:
        railway_conn.rollback()
        print(f'  [{table_name}] FAILED: {e}')
        return -1


def main():
    # Parse args
    only_table = None
    if '--table' in sys.argv:
        idx = sys.argv.index('--table')
        if idx + 1 < len(sys.argv):
            only_table = sys.argv[idx + 1]

    # Get passwords
    local_pass = LOCAL_PASS or get_vault_secret('pg-password')
    railway_pass = RAILWAY_PASS or '7482e8ad2f0521a47329e1ea3f049caf'

    if not local_pass:
        print('ERROR: No local PG password. Set PG_PASSWORD or ensure az CLI is authenticated.')
        sys.exit(1)

    # Connect
    local_conn = psycopg2.connect(
        host=LOCAL_HOST, port=LOCAL_PORT, database=LOCAL_DB,
        user=LOCAL_USER, password=local_pass
    )
    railway_conn = psycopg2.connect(
        host=RAILWAY_HOST, port=int(RAILWAY_PORT), database=RAILWAY_DB,
        user=RAILWAY_USER, password=railway_pass
    )

    print('=' * 60)
    print('SYNC — Local Web Schema to Railway')
    print(f'Started: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'Local: {LOCAL_DB} @ {LOCAL_HOST}')
    print(f'Railway: {RAILWAY_DB} @ {RAILWAY_HOST}:{RAILWAY_PORT}')
    print('=' * 60)

    # Get list of tables in web schema
    cur = local_conn.cursor()
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'web' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    """)
    tables = [r[0] for r in cur.fetchall()]

    if not tables:
        print('No tables found in web schema. Run materialize.py first.')
        sys.exit(0)

    total_rows = 0
    total_tables = 0

    for table in tables:
        if only_table and table != only_table:
            continue
        rows = sync_table(local_conn, railway_conn, table)
        if rows >= 0:
            total_rows += rows
            total_tables += 1

    print('=' * 60)
    print(f'Complete: {total_tables} tables synced, {total_rows:,} total rows')
    print(f'Finished: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    local_conn.close()
    railway_conn.close()


if __name__ == '__main__':
    main()
