"""إدارة جهات الاتصال + استيراد CSV ذكي."""
import csv, io, re
from sqlalchemy.orm import Session
from app.db.models import Contact

PHONE_RE = re.compile(r"^\+?[1-9]\d{7,14}$")

def normalize_phone(raw: str) -> str:
    p = re.sub(r"[^0-9+]", "", raw or "")
    if p.startswith("00"): p = "+" + p[2:]
    if not p.startswith("+"): p = "+998" + p if p.startswith("9") else "+" + p
    return p

def is_valid_phone(p: str) -> bool:
    return bool(PHONE_RE.match(p))

def import_csv(db: Session, content: str) -> dict:
    """يتوقع عمود phone إلزاميًا؛ باقي الأعمدة تصبح attributes للتخصيص."""
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames or "phone" not in [c.lower().strip() for c in reader.fieldnames]:
        raise ValueError("CSV must contain a 'phone' column")
    keymap = {c.lower().strip(): c for c in reader.fieldnames}
    created = updated = skipped = 0
    for row in reader:
        raw = (row.get(keymap["phone"]) or "").strip()
        phone = normalize_phone(raw)
        if not is_valid_phone(phone):
            skipped += 1; continue
        attrs = {k: v for k, v in row.items() if k != keymap["phone"] and v not in (None, "")}
        name = (attrs.get("name") or "").strip()
        c = db.query(Contact).filter_by(phone=phone).first()
        if c:
            c.attributes = attrs; c.name = name or c.name; updated += 1
        else:
            db.add(Contact(phone=phone, name=name, attributes=attrs)); created += 1
    db.commit()
    return {"created": created, "updated": updated, "skipped_invalid": skipped}

def bulk_add(db: Session, items: list[dict]) -> int:
    n = 0
    for it in items:
        phone = normalize_phone(it.get("phone", ""))
        if not is_valid_phone(phone): continue
        if not db.query(Contact).filter_by(phone=phone).first():
            db.add(Contact(phone=phone, name=it.get("name", ""),
                           attributes={k: v for k, v in it.items() if k not in ("phone", "name")}))
            n += 1
    db.commit(); return n
