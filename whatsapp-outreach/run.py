#!/usr/bin/env python3
"""تشغيل النظام: python run.py  ->  http://localhost:8000"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.makedirs("data", exist_ok=True)
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
