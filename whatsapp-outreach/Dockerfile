FROM python:3.12-slim
WORKDIR /srv/app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# مجلد البيانات على مسار دائم (يُعلَّق كـ Persistent Disk في Render/Manus)
RUN mkdir -p /data
ENV DATABASE_URL=sqlite:////data/outreach.db
EXPOSE 8000
CMD ["python", "run.py"]
