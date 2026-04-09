@echo off
REM CAE Web Portal — Post-Load Pipeline
REM Runs after cae_postgresql_daily_load (8:20 PM)
REM Schedule: 8:45 PM daily
REM
REM Chain:
REM   1. Redistribute closed records from APM to year tables
REM   2. Materialize gold views to web schema (local)
REM   3. Sync web schema to Railway PostgreSQL

echo ============================================================
echo CAE POST-LOAD PIPELINE — %date% %time%
echo ============================================================

REM Step 1: Redistribute APM to year tables
echo.
echo [Step 1] Redistributing closed records to year tables...
cd /d "C:\Users\Manzano\Manzano Life\CRMLS - Documents\CRMLSData_Pipeline\Scripts\Python_Redistribute_APMClosed"
python redistribute_apm_to_years_direct.py
if %errorlevel% neq 0 (
    echo [WARNING] Redistribute failed. Continuing with materialize...
)

REM Step 2: Materialize gold views to web schema
echo.
echo [Step 2] Materializing gold views...
cd /d "C:\Users\Manzano\GitHub_Repos\cae-portal"
python scripts\materialize.py
if %errorlevel% neq 0 (
    echo [ERROR] Materialization failed. Sync skipped.
    exit /b 1
)

REM Step 3: Sync web schema to Railway
echo.
echo [Step 3] Syncing to Railway...
python scripts\sync_to_railway.py
if %errorlevel% neq 0 (
    echo [ERROR] Sync to Railway failed.
    exit /b 1
)

echo.
echo ============================================================
echo [DONE] Post-load pipeline complete — %time%
echo ============================================================
