#!/usr/bin/env python3
"""تشغيل النظام: python run.py  ->  http://localhost:8000"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.makedirs("data", exist_ok=True)
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))  # Render/Manus يمرّر PORT تلقائيًا
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
