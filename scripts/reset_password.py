import sys
import os
sys.path.insert(0, os.path.abspath("backend"))
from app.models.user import User
from app.db.session import SessionLocal

db = SessionLocal()
user = db.query(User).filter(User.email == "enmsoftware@gmail.com").first()
if user:
    user.set_password("enmsoftware")
    db.commit()
    print("Password reset successfully")
else:
    print("User not found")
