@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0rollback-and-deploy.ps1" %*
